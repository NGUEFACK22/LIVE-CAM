import 'server-only'
import { normalize, SERVICES, type CanonCountry, type CanonService } from '@/lib/numbers/catalog'
import { resolveVsnApiKey } from '@/lib/numbers/vsn-config'
import { getEurPerUsd, nativeToUsd } from '@/lib/numbers/pricing'
import type { CodeResult, ProviderAdapter, PurchaseResult, Quote } from './types'
import { normalizePhone } from './types'
import type { BuyQuality } from '@/lib/numbers/types'

// Adaptateur VirtualSMSNumbers (https://virtualsmsnumbers.com/api/v1).
// REST JSON, paiement prepayé, montants en centimes d'€ (`*_cents`).
// Commandes ponctuelles (activations) : réservation 20 min, code lu via
// GET /activations/{id} (ou long-poll ?wait=), remboursement auto à l'expiration.
const BASE = 'https://virtualsmsnumbers.com/api/v1'

type ApiResult<T> = { ok: boolean; status: number; json: T | null; errorCode: string }

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<ApiResult<T>> {
  const { key } = await resolveVsnApiKey()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (auth && key) headers.set('Authorization', `Bearer ${key}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    ...init,
    headers,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  const err = (json ?? null) as { error?: { code?: string; message?: string } }
  const errorCode = res.ok ? '' : (err?.error?.code ?? (res.status >= 500 ? 'internal_error' : 'http_error'))
  return { ok: res.ok, status: res.status, json: json as T, errorCode }
}

// ---------------------------------------------------------------------------
// Référentiels (pays / services / prix) résolus dynamiquement, mis en cache.
// ---------------------------------------------------------------------------

type ServiceRef = { id: number; slug: string; code: string }
let servicesCache: { items: ServiceRef[]; at: number } | null = null

type CountryRef = { id: number; code: string }
let countriesCache: { items: CountryRef[]; at: number } | null = null
const REF_TTL = 60 * 60 * 1000 // 1 h : listes lentes, déjà mises en cache 5 min côté serveur

async function servicesRef(): Promise<ServiceRef[]> {
  if (servicesCache && Date.now() - servicesCache.at < REF_TTL) return servicesCache.items
  const { json } = await request<{ object: string; data: ServiceRef[] }>('/services', {}, false)
  servicesCache = { items: json?.data ?? [], at: Date.now() }
  return servicesCache.items
}

async function countriesRef(): Promise<CountryRef[]> {
  if (!countriesCache || Date.now() - countriesCache.at >= REF_TTL) {
    const { json } = await request<{ object: string; data: CountryRef[] }>('/countries', {}, false)
    countriesCache = { items: json?.data ?? [], at: Date.now() }
  }
  return countriesCache.items
}

async function countrySupported(code: string): Promise<boolean> {
  const items = await countriesRef()
  return items.some((c) => String(c.code).toUpperCase() === code.toUpperCase())
}

type PriceRow = {
  service: string
  service_code: string
  service_name: string
  country: string
  country_name: string
  price_cents: number
  price: string
  currency: string
  available: number
  success_rate: number
}

// Prix par pays = la source de vérité du catalogue (dispo + taux mesuré).
const priceCache = new Map<string, { data: PriceRow[]; at: number }>()
const PRICE_TTL = 60 * 1000

async function pricesFor(country: string, service?: string | null): Promise<PriceRow[]> {
  const qs = new URLSearchParams({ country: country.toUpperCase() })
  if (service) qs.set('service', service)
  const key = qs.toString()
  const hit = priceCache.get(key)
  if (hit && Date.now() - hit.at < PRICE_TTL) return hit.data
  const { json } = await request<{ object: string; data: PriceRow[] }>(`/prices?${qs.toString()}`, {}, false)
  const data = (json?.data ?? []).filter((r) => r.available > 0)
  priceCache.set(key, { data, at: Date.now() })
  return data
}

/** Match entre une entrée fournisseur (slug/code) et un mot-clé canonique. */
function matches(slugOrCode: string, keyword: string): boolean {
  const k = normalize(slugOrCode)
  const m = normalize(keyword)
  return k === m || k.includes(m) || m.includes(k)
}

/** Vrai si le service canonique correspond à l'entrée fournisseur (slug OU code). */
function serviceHits(item: { slug: string; code?: string }, service: CanonService): boolean {
  return service.match.some((m) => matches(item.slug, m) || matches(String(item.code ?? ''), m))
}

/** Résout le slug EXACT du service à envoyer à l'API (obligatoire à l'achat). */
async function resolveService(service: CanonService): Promise<string | null> {
  const refs = await servicesRef()
  return refs.find((it) => serviceHits(it, service))?.slug ?? null
}

/** Résout l'id numérique du service (utilisé par le devis location). */
async function vsnServiceId(service: CanonService): Promise<number | null> {
  const refs = await servicesRef()
  return refs.find((it) => serviceHits(it, service))?.id ?? null
}

/** Résout l'id numérique du pays (utilisé par le devis location). */
async function vsnCountryId(code: string): Promise<number | null> {
  const items = await countriesRef()
  return items.find((c) => String(c.code).toUpperCase() === code.toUpperCase())?.id ?? null
}

// ---------------------------------------------------------------------------
// Location (numéro gardé sur une durée, messages illimités).
// Durées acceptées par POST /rentals (tout autre valeur -> 422 invalid_duration).
// ---------------------------------------------------------------------------
const RENT_DURATIONS = [4, 12, 24, 72, 168, 720, 2160]

/** Fenêtre de location supportée la plus proche >= minHours (jamais inférieure). */
function nearestDuration(minHours: number): number {
  return RENT_DURATIONS.find((h) => h >= Math.max(1, minHours)) ?? RENT_DURATIONS[RENT_DURATIONS.length - 1]
}

type RentalQuote = { available: boolean; priceCents: number }

// Prix location réels exposés par le calculateur public du site
// (/api/catalog/rental-quote — appelé par la page /rent). HORS /api/v1 : pas
// d'en-tête d'auth (la clé ne transite jamais vers ce chemin), valeurs en
// centimes d'€. Cache court pour ne pas écraser le bucket rate-limit IP.
const rentalQuoteCache = new Map<string, { data: RentalQuote; at: number }>()
const RENTAL_QUOTE_TTL = 60 * 1000

async function quoteRentalCents(countryId: number, serviceId: number, hours: number): Promise<RentalQuote | null> {
  const key = `${countryId}:${serviceId}:${hours}`
  const hit = rentalQuoteCache.get(key)
  if (hit && Date.now() - hit.at < RENTAL_QUOTE_TTL) return hit.data
  try {
    const qs = new URLSearchParams({ country: String(countryId), service: String(serviceId), hours: String(hours) })
    const res = await fetch(`https://virtualsmsnumbers.com/api/catalog/rental-quote?${qs.toString()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as RentalQuote
    if (!json || json.available !== true || !(json.priceCents > 0)) return null
    rentalQuoteCache.set(key, { data: json, at: Date.now() })
    return json
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

type Activation = {
  id: string
  object: string
  status: string
  phone_number?: string
  country?: string
  service?: string
  price_cents: number
  currency?: string
  expires_at?: string
  code?: string | null
  messages?: { sender?: string; text?: string; code?: string; received_at?: string }[]
}

export const virtualSmsNumbers: ProviderAdapter = {
  id: 'virtual_sms_numbers',
  name: 'VirtualSMSNumbers',
  supportsPremium: true,

  async services(country: CanonCountry): Promise<string[]> {
    if (!(await countrySupported(country.code))) return []
    const rows = await pricesFor(country.code)
    if (rows.length === 0) return []
    const items = rows.map((r) => ({ slug: r.service, code: r.service_code }))
    return SERVICES.filter((s) => items.some((it) => serviceHits(it, s))).map((s) => s.slug)
  },

  async quote(country: CanonCountry, service: CanonService, quality?: BuyQuality): Promise<Quote | null> {
    if (!(await countrySupported(country.code))) return null
    const vsnService = await resolveService(service)
    if (!vsnService) return null
    const rows = await pricesFor(country.code, vsnService)
    const row = rows[0] ?? null
    if (!row) return null
    const costUsd = await nativeToUsd(row.price_cents / 100, 'EUR')
    // Pas de sélection d'opérateur chez ce fournisseur : le mode premium
    // utilise la même offre (c'est le prix client, 1,5×, qui définit le premium).
    return {
      provider: 'virtual_sms_numbers',
      costUsd,
      count: row.available,
      successRate: Math.max(1, Math.round(row.success_rate * 100)),
    }
  },

  async purchase(
    country: CanonCountry,
    service: CanonService,
    maxCostUsd?: number,
    quality?: BuyQuality,
  ): Promise<PurchaseResult> {
    if (!(await countrySupported(country.code))) throw new Error('VSN_UNSUPPORTED: pays/service non disponible')
    const vsnService = await resolveService(service)
    if (!vsnService) throw new Error('VSN_UNSUPPORTED: pays/service non disponible')

    // Plafond anti-casse : convertit le coût maximum accepté (USD) en centimes €.
    const eurPerUsd = await getEurPerUsd()
    const maxPriceCents =
      maxCostUsd && maxCostUsd > 0 ? Math.max(1, Math.round(maxCostUsd * eurPerUsd * 100)) : undefined

    for (let attempt = 0; attempt < 4; attempt++) {
      const body: Record<string, unknown> = {
        service: vsnService,
        country: country.code.toUpperCase(),
      }
      if (maxPriceCents) body.max_price_cents = maxPriceCents
      if (quality === 'premium') body.allow_multiple_sms = true
      const { ok, json, errorCode } = await request<Activation>('/activations', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      })
      const act = json
      if (ok && act?.id) {
        return {
          provider: 'virtual_sms_numbers',
          providerOrder: act.id,
          phone: normalizePhone(act.phone_number ?? ''),
          costUsd: act.price_cents > 0 ? await nativeToUsd(act.price_cents / 100, 'EUR') : 0,
          expiresAt: parseExpiry(act.expires_at),
        }
      }
      if (errorCode === 'insufficient_funds' || errorCode === 'top_up_required') {
        throw new Error('VSN_BALANCE: solde fournisseur insuffisant')
      }
      if (errorCode === 'unknown_service' || errorCode === 'unknown_country' || errorCode === 'invalid_request') {
        throw new Error('VSN_UNSUPPORTED: combinaison pays/service non supportée')
      }
      if (errorCode === 'no_stock') {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 600))
          continue
        }
        throw new Error('VSN_NO_NUMBERS: aucun numéro disponible actuellement')
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 700))
    }
    throw new Error('VSN_UNKNOWN: achat impossible')
  },

  async rentQuote(country: CanonCountry, service: CanonService, minHours: number): Promise<Quote | null> {
    if (!(await countrySupported(country.code))) return null
    const countryId = await vsnCountryId(country.code)
    const serviceId = await vsnServiceId(service)
    if (!countryId || !serviceId) return null
    const hours = nearestDuration(minHours)
    const quote = await quoteRentalCents(countryId, serviceId, hours)
    if (!quote) return null
    const costUsd = await nativeToUsd(quote.priceCents / 100, 'EUR')
    // Le taux de réussite affiché est celui du couple (pays/service) mesuré sur
    // les activations : indicateur de qualité de la ligne pour le même marché.
    const row = (await pricesFor(country.code)).find((r) => String(r.service) === String(service.slug))
    return {
      provider: 'virtual_sms_numbers',
      costUsd,
      count: row?.available ?? 1,
      successRate: row ? Math.max(1, Math.round(row.success_rate * 100)) : undefined,
    }
  },

  async rent(
    country: CanonCountry,
    service: CanonService,
    minHours: number,
    maxCostUsd?: number,
  ): Promise<PurchaseResult> {
    if (!(await countrySupported(country.code))) throw new Error('VSN_UNSUPPORTED: pays/service non disponible')
    const vsnService = await resolveService(service)
    if (!vsnService) throw new Error('VSN_UNSUPPORTED: pays/service non disponible')
    const hours = nearestDuration(minHours)

    for (let attempt = 0; attempt < 4; attempt++) {
      // La facturation VSN est au prix VRAI renvoyé à la location (pas de
      // plafond `max_price` sur /rentals) : le prix client (POINTS) est débité
      // après la réponse, sur le coût réel × marge.
      const { ok, json, errorCode } = await request<Rental>(
        '/rentals',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            country: country.code.toUpperCase(),
            service: vsnService,
            duration_hours: hours,
            auto_renew: false,
          }),
        },
      )
      if (ok && json?.id) {
        return {
          provider: 'virtual_sms_numbers',
          providerOrder: json.id,
          phone: normalizePhone(json.phone_number ?? ''),
          costUsd: json.price_cents > 0 ? await nativeToUsd(json.price_cents / 100, 'EUR') : 0,
          expiresAt: parseExpiry(json.ends_at),
        }
      }
      if (errorCode === 'insufficient_funds' || errorCode === 'top_up_required') {
        throw new Error('VSN_BALANCE: solde fournisseur insuffisant')
      }
      if (errorCode === 'invalid_duration' || errorCode === 'invalid_request') {
        throw new Error('VSN_UNSUPPORTED: durée de location non supportée')
      }
      if (errorCode === 'unknown_service' || errorCode === 'unknown_country') {
        throw new Error('VSN_UNSUPPORTED: combinaison pays/service non supportée')
      }
      if (errorCode === 'no_stock') {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 600))
          continue
        }
        throw new Error('VSN_NO_NUMBERS: aucun numéro disponible actuellement')
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 700))
    }
    throw new Error('VSN_UNKNOWN: location impossible')
  },

  async getCode(providerOrder: string): Promise<CodeResult> {
    const { ok, json, errorCode } = await request<Activation>(`/activations/${providerOrder}`)
    if (!ok) {
      // Activation introuvable : ce n'est peut-être pas une activation mais une
      // LOCATION (les id rentals et activations vivent au même format).
      if (errorCode === 'not_found') {
        const { json: list } = await request<{ object: string; data: Rental[] }>('/rentals')
        const rental = (list?.data ?? []).find((r) => r.id === providerOrder)
        if (rental) return rentalCode(rental)
      }
      // Erreur transitoire (5xx, rate limit…) : on reste en attente.
      return { status: 'waiting' }
    }
    const act = json
    if (!act) return { status: 'waiting' }
    const msgs = Array.isArray(act.messages) ? act.messages : []
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1]
      const code = last.code || extractCode(last.text ?? '')
      return { status: 'received', code: code || last.text || null, fullSms: last.text ?? null }
    }
    const status = String(act.status ?? '')
    if (['cancelled', 'expired', 'refunded', 'completed'].includes(status)) return { status: 'cancelled' }
    return { status: 'waiting' }
  },

  async cancel(providerOrder: string): Promise<void> {
    const r = await request(`/activations/${providerOrder}/cancel`, { method: 'POST' })
    // Location : pas d'API d'annulation chez VSN (remboursement uniquement via
    // le dashboard < 20 min et sans message reçu). On laisse courir la location.
    if (r.errorCode === 'not_found') {
      console.log('[v0] vsn cancel: location — pas d’annulation API (20 min dashboard)')
    }
  },

  async finish(providerOrder: string): Promise<void> {
    const r = await request(`/activations/${providerOrder}/complete`, { method: 'POST' })
    // Location : pas de clôture API ; la fenêtre se termine d'elle-même.
    if (r.errorCode === 'not_found') {
      console.log('[v0] vsn finish: location — clôture automatique en fin de fenêtre')
    }
  },
}

/** Extrait un code de vérification du texte d'un SMS (4-8 chiffres, tolère les tirets). */
function extractCode(text: string): string | null {
  if (!text) return null
  const labeled = text.match(/(?:code|código|код)\D{0,20}(\d(?:\D?\d){3,7})/i)
  if (labeled) return labeled[1].replace(/\D/g, '')
  const bare = text.match(/\b(\d(?:\D?\d){3,7})\b/)
  return bare ? bare[1].replace(/\D/g, '') : null
}

/** Date d'expiration renvoyée par l'API (délai réel), sinon +20 min par défaut. */
function parseExpiry(raw: string | undefined): Date {
  const d = raw ? new Date(raw) : null
  return d && !isNaN(d.getTime()) && d.getTime() > Date.now()
    ? d
    : new Date(Date.now() + 20 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Location — enregistrement renvoyé par GET /rentals & POST /rentals.
// ---------------------------------------------------------------------------
type Rental = {
  id: string
  object?: string
  status: string
  phone_number?: string
  country?: string
  service?: string
  duration_hours?: number
  price_cents: number
  currency?: string
  starts_at?: string
  ends_at?: string
  messages?: { sender?: string; text?: string; code?: string; received_at?: string }[]
}

/** Statut + code des messages d'une location (tous les SMS de la fenêtre). */
function rentalCode(rental: Rental): CodeResult {
  const msgs = Array.isArray(rental.messages) ? rental.messages : []
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1]
    const code = last.code || extractCode(last.text ?? '')
    return { status: 'received', code: code || last.text || null, fullSms: last.text ?? null }
  }
  const live = ['active', 'waiting', 'pending'].includes(String(rental.status ?? ''))
  return live ? { status: 'waiting' } : { status: 'cancelled' }
}