import 'server-only'
import { normalize, SERVICES, type CanonCountry, type CanonService } from '@/lib/numbers/catalog'
import { resolveFiveSimApiKey } from '@/lib/numbers/five-sim-config'
import { nativeToUsd } from '@/lib/numbers/pricing'
import type { CodeResult, ProviderAdapter, PurchaseResult, Quote } from './types'
import { normalizePhone } from './types'

// Adaptateur 5sim (https://5sim.net/docs).
// Fournisseur de vérification par SMS unique (même modèle que sms-man) :
// commande ponctuelle, code reçu via polling GET /user/check/:id.
// Prix en RUB ; ready-to-use `Authorization: Bearer <token JWT>`.
const BASE = 'https://5sim.net/v1'

async function api<T = unknown>(path: string): Promise<{ status: number; json: T | null; text: string }> {
  const { key } = await resolveFiveSimApiKey()
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  const text = await res.text()
  let json: T | null = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

// ---------------------------------------------------------------------------
// Référentiels (pays / produits) résolus dynamiquement, mis en cache.
// ---------------------------------------------------------------------------

type CountryRef = { iso?: Record<string, number>; prefix?: Record<string, number>; text_en?: string }
let countryCache: { countries: Record<string, CountryRef>; at: number } | null = null
const REF_TTL = 12 * 60 * 60 * 1000

async function countriesRefs(): Promise<Record<string, CountryRef>> {
  if (countryCache && Date.now() - countryCache.at < REF_TTL) return countryCache.countries
  const { json } = await api<Record<string, CountryRef>>('/guest/countries')
  const countries = json ?? {}
  countryCache = { countries, at: Date.now() }
  return countries
}

/**
 * Résout un pays canonique vers la clé 5sim (ex: "england", "usa").
 * Résolution STRICTEMENT par code ISO : fiable et sans faux positif
 * (ex: "niger" ⊂ "nigeria" via mots-clés) — un pays non couvert par 5sim
 * renvoie null et est simplement marqué "Indisponible".
 */
async function resolveCountry(country: CanonCountry): Promise<string | null> {
  const refs = await countriesRefs()
  const iso = String(country.code ?? '').toLowerCase()
  return Object.keys(refs).find((k) => refs[k].iso?.[iso]) ?? null
}

let productCache: { byCountry: Record<string, string[]>; at: number } | null = null

/** Liste des produits 5sim (clés exactes) pour un pays — pour matcher les services. */
async function productsFor(countryKey: string): Promise<string[]> {
  if (productCache && Date.now() - productCache.at < REF_TTL) {
    const cached = productCache.byCountry[countryKey]
    if (cached) return cached
  }
  const { json } = await api<Record<string, unknown>>(`/guest/products/${countryKey}/any`)
  const products = Object.keys(json ?? {})
  // Le catalogue de produits varie PAR PAYS : on met en cache par pays.
  productCache = { byCountry: { ...(productCache?.byCountry ?? {}), [countryKey]: products }, at: Date.now() }
  return products
}

async function resolveProduct(countryKey: string, service: CanonService): Promise<string | null> {
  const products = await productsFor(countryKey)
  if (products.length === 0) return null
  return (
    products.find((p) =>
      service.match.some((m) => {
        const key = normalize(p)
        const mw = normalize(m)
        return key === mw || key.includes(mw) || mw.includes(key)
      }),
    ) ?? null
  )
}

type PriceEntry = {
  cost: number | string
  count: number | string
  rate?: number | string
}

type Order = {
  id: number | string
  phone?: string
  product?: string
  price?: number | string
  status?: string
  expires?: string
  created_at?: string
  sms?: { sender?: string; text?: string; code?: string }[]
  error?: string
}

/** Résout pays + produit 5sim pour un couple canonique. */
async function resolve(country: CanonCountry, service: CanonService) {
  const countryKey = await resolveCountry(country)
  if (!countryKey) return { countryKey: null, productKey: null }
  const productKey = await resolveProduct(countryKey, service)
  return { countryKey, productKey }
}

/** Extrait la première erreur typée d'un corps JSON 5sim (ex: "no free phones"). */
function errorText(json: unknown): string {
  const data = (json ?? {}) as { error?: string; message?: string }
  return data.error || data.message || ''
}

/**
 * 5sim renvoie un taux de livraison par opérateur (`rate`, en %), omis quand il
 * est < 20 % ou qu'il y a trop peu de commandes. On prend le MEILLEUR taux du
 * pays (l'achat se fait avec operator=any, 5sim choisit l'opérateur pertinent).
 * Quand aucun taux n'est fourni, on estime depuis la quantité totale.
 */
function effectiveRate(entries: PriceEntry[], count: number): number {
  const rates = entries.map((e) => Number(e.rate ?? 0)).filter((r) => r > 0)
  if (rates.length > 0) return Math.max(0, Math.min(100, Math.max(...rates)))
  if (!(count > 0)) return 0
  return Math.max(80, Math.min(95, 80 + Math.floor(Math.log10(count)) * 3))
}

export const fiveSim: ProviderAdapter = {
  id: 'five_sim',
  name: '5sim',

  async services(country: CanonCountry): Promise<string[]> {
    const countryKey = await resolveCountry(country)
    if (!countryKey) return []
    const products = await productsFor(countryKey)
    if (products.length === 0) return []
    return SERVICES.filter((s) =>
      products.some((p) =>
        s.match.some((m) => {
          const key = normalize(p)
          const mw = normalize(m)
          return key === mw || key.includes(mw) || mw.includes(key)
        }),
      ),
    ).map((s) => s.slug)
  },

  async quote(country: CanonCountry, service: CanonService): Promise<Quote | null> {
    const { countryKey, productKey } = await resolve(country, service)
    if (!countryKey || !productKey) return null

    // /guest/prices?country=..&product=.. -> { "<pays>": { "<produit>": { "<op>": { cost, count, rate } } } }
    const { json } = await api<Record<string, Record<string, Record<string, PriceEntry>>>>(
      `/guest/prices?country=${encodeURIComponent(countryKey)}&product=${encodeURIComponent(productKey)}`,
    )
    const perOperator = json?.[countryKey]?.[productKey]
    const entries = perOperator ? Object.values(perOperator) : []
    if (entries.length === 0) return null

    let best: PriceEntry | undefined
    let count = 0
    for (const entry of entries) {
      const c = Number(entry?.count ?? 0)
      if (!isNaN(c)) count += c
      const cost = Number(entry?.cost ?? 0)
      if (cost > 0 && (!best || cost < Number(best.cost))) best = entry
    }
    // Stock vide sur tout le pays pour ce produit : pas de devis (ex: sms-man).
    if (!best || count <= 0) return null

    const costUsd = await nativeToUsd(Number(best.cost), 'RUB')
    return {
      provider: 'five_sim',
      costUsd,
      count,
      successRate: effectiveRate(entries, count),
    }
  },

  async purchase(country: CanonCountry, service: CanonService): Promise<PurchaseResult> {
    const { countryKey, productKey } = await resolve(country, service)
    if (!countryKey || !productKey) throw new Error('FIVE_SIM_UNSUPPORTED: pays/service non disponible')

    // "any" : 5sim choisit lui-même l'opérateur le plus pertinent. On réessaie
    // quelques fois pour absorber les "no free phones" transitoires.
    let last = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      const { status, json } = await api<Order>(
        `/user/buy/activation/${encodeURIComponent(countryKey)}/any/${encodeURIComponent(productKey)}`,
      )
      const data = (json ?? {}) as Order
      if (status === 200 && data.id && !data.error) {
        return {
          provider: 'five_sim',
          providerOrder: String(data.id),
          phone: normalizePhone(data.phone ?? ''),
          costUsd: Number(data.price ?? 0) > 0 ? await nativeToUsd(Number(data.price), 'RUB') : 0,
          // Fenêtre 5sim renvoyée par l'API (sinon +15 min par défaut).
          expiresAt: parseExpiry(data.expires),
        }
      }
      last = errorText(json)
      // Solde fournisseur insuffisant : inutile de réessayer.
      if (last.includes('balance')) break
      if (attempt < 3) await new Promise((r) => setTimeout(r, 700))
    }

    if (last.includes('balance')) throw new Error('FIVE_SIM_BALANCE: solde fournisseur insuffisant')
    if (last.includes('no free phones')) throw new Error('FIVE_SIM_NO_NUMBERS: aucun numéro disponible actuellement')
    throw new Error(`5sim: ${last || 'achat impossible'}`)
  },

  async getCode(providerOrder: string): Promise<CodeResult> {
    const { json } = await api<Order>(`/user/check/${providerOrder}`)
    const data = (json ?? {}) as Order

    // Commande réellement INTROUVABLE côté 5sim ("Order not found", sans id) :
    // plus rien à attendre -> annulation + remboursement automatique. En
    // revanche, une erreur transitoire (5xx, rate limit…) n'invalide PAS une
    // commande encore valide : on reste en attente plutôt que de rembourser par
    // erreur un numéro qui recevra son SMS.
    if (!data.id) {
      if (/order not found|no such order|unknown order|not found/i.test(errorText(json))) {
        return { status: 'cancelled' }
      }
      return { status: 'waiting' }
    }

    const sms = Array.isArray(data.sms) ? data.sms : []
    if (sms.length > 0) {
      const lastSms = sms[sms.length - 1]
      const code = lastSms.code || extractCode(lastSms.text ?? '')
      return { status: 'received', code: code || lastSms.text || null, fullSms: lastSms.text ?? null }
    }

    const status = String(data.status ?? '').toUpperCase()
    // Commandes terminées SANS SMS (annulée, expirée, bannie) -> à rembourser.
    if (['CANCELED', 'CANCELLED', 'TIMEOUT', 'BANNED', 'FINISHED'].includes(status)) return { status: 'cancelled' }
    return { status: 'waiting' }
  },

  async cancel(providerOrder: string): Promise<void> {
    await api(`/user/cancel/${providerOrder}`)
  },

  async finish(providerOrder: string): Promise<void> {
    await api(`/user/finish/${providerOrder}`)
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

/** Date d'expiration 5sim (délai réel) si valide et future, sinon +15 min. */
function parseExpiry(raw: string | undefined): Date {
  const d = raw ? new Date(raw) : null
  return d && !isNaN(d.getTime()) && d.getTime() > Date.now()
    ? d
    : new Date(Date.now() + 15 * 60 * 1000)
}