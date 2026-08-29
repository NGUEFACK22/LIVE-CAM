// ============================================================
// GeniusPay — passerelle de paiement unifiee pour l'Afrique
// (Wave, Orange Money, MTN MoMo, Moov, cartes bancaires, etc.).
// Flux documente (geniuspay.ci/docs/api) :
//   1) POST /api/v1/merchant/payments -> cree le paiement
//      (sans `payment_method` => page de checkout hebergee)
//   2) redirection du client vers `checkout_url`
//   3) GET /api/v1/merchant/payments/{reference} -> statut autoritaire
// Source de verite : la reconfirmation cote serveur via l'API
// GeniusPay (headers X-API-Key + X-API-Secret), jamais le corps
// d'un callback/retour (voir app/api/payment/*).
// Auth : X-API-Key (cle publique, "API Key") + X-API-Secret
// (cle secrete, signature/rechauffement cote serveur uniquement).
//
// RESILIENCE : timeout 15s + 1 retry automatique (Vercel peut avoir
// des difficultes reseau vers geniuspay.ci, surtout depuis les
// serveurs serverless).
// ============================================================

const GENIUSPAY_BASE_URL = 'https://geniuspay.ci/api/v1/merchant'
const GENIUSPAY_TIMEOUT_MS = 15_000 // 15 secondes par tentative
const GENIUSPAY_MAX_RETRIES = 1 // 1 retry = 2 tentatives au total

// Helper : fetch avec timeout via AbortController
async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
  timeoutMs = GENIUSPAY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Cle(s) GeniusPay presentes ? La cle secrete ne doit JAMAIS etre exposee
// cote client : ces fonctions ne sont utilisees que dans les routes serveur.
export function geniuspayConfigured(): boolean {
  return !!(process.env.GENIUSPAY_API_KEY && process.env.GENIUSPAY_API_SECRET)
}

export function geniuspayHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.GENIUSPAY_API_KEY || '',
    'X-API-Secret': process.env.GENIUSPAY_API_SECRET || '',
  }
}

export interface GeniusPayCreateParams {
  description: string
  amount: number // entier, en XOF (min. 200)
  callbackUrl: string // success_url / error_url (retour navigateur apres checkout)
  customMetadata: Record<string, any>
  customer?: { name?: string; email?: string; phone?: string }
}

export interface GeniusPayCreatedPayment {
  id: string // id numerique de la transaction (audit)
  reference: string // reference GeniusPay (notre "token" interne pour GET /payments/{reference})
  checkoutUrl: string // page de paiement hebergee (checkout)
}

// Cree un paiement GeniusPay. Sans `payment_method`, l'API renvoie une URL
// de checkout hebergee ou le client choisit Wave / Orange / MTN / Moov / carte.
// Retourne null si la config est absente ou si l'API echoue.
export async function createGeniusPayPayment(
  params: GeniusPayCreateParams,
): Promise<GeniusPayCreatedPayment | null> {
  if (!geniuspayConfigured()) return null

  try {
    let lastError: any = null
    for (let attempt = 0; attempt <= GENIUSPAY_MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.warn(`[GeniusPay] Creation : retry #${attempt}/${GENIUSPAY_MAX_RETRIES}...`)
          // Attendre 1s avant le retry
          await new Promise((r) => setTimeout(r, 1000))
        }
        const res = await fetchWithTimeout(`${GENIUSPAY_BASE_URL}/payments`, {
          method: 'POST',
          headers: geniuspayHeaders(),
          body: JSON.stringify({
            amount: Math.round(params.amount),
            currency: 'XOF',
            description: params.description,
            success_url: params.callbackUrl,
            error_url: params.callbackUrl,
            metadata: params.customMetadata,
            ...(params.customer ? { customer: params.customer } : {}),
          }),
          cache: 'no-store',
        })
        const text = await res.text()
        let data: any
        try {
          data = JSON.parse(text)
        } catch {
          console.error(
            `[GeniusPay] Creation : reponse non-JSON (HTTP ${res.status}):`,
            text.slice(0, 500),
          )
          lastError = new Error(`Non-JSON response HTTP ${res.status}`)
          continue // retry
        }
        if (!res.ok || !data?.data?.reference || !data?.data?.checkout_url) {
          console.error(
            `[GeniusPay] Creation echouee (HTTP ${res.status}):`,
            text.slice(0, 500),
          )
          // Erreur serveur (5xx) ou rate-limit (429) : on retry
          if (res.status >= 500 || res.status === 429) {
            lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
            continue // retry
          }
          // Erreur client (4xx sauf 429) : pas de retry
          return null
        }
        const d = data.data
        return {
          id: String(d.id),
          reference: String(d.reference),
          checkoutUrl: String(d.checkout_url),
        }
      } catch (netErr) {
        lastError = netErr
        const isAbort = netErr instanceof Error && netErr.name === 'AbortError'
        console.error(
          `[GeniusPay] Creation : ${isAbort ? 'timeout' : 'appel API injoignable'} (tentative ${attempt + 1}/${GENIUSPAY_MAX_RETRIES + 1}):`,
          isAbort ? `${GENIUSPAY_TIMEOUT_MS}ms depasse` : netErr,
        )
        // Timeout ou erreur reseau : on retry si pas de tentatives restantes
        continue
      }
    }
    console.error('[GeniusPay] Creation : echec definitif apres', GENIUSPAY_MAX_RETRIES + 1, 'tentatives:', lastError)
    return null
  } catch (error) {
    console.error('[GeniusPay] Erreur create:', error)
    return null
  }
}

export interface GeniusPayPaymentInfo {
  id: string
  reference: string
  status: string // brut GeniusPay : pending | completed | failed | cancelled | ...
  amount: number
  metadata: Record<string, any>
  raw: any
}

// Statut autoritaire d'un paiement GeniusPay (server-to-server).
export async function getGeniusPayPayment(reference: string): Promise<GeniusPayPaymentInfo | null> {
  if (!geniuspayConfigured()) return null
  let lastError: any = null
  for (let attempt = 0; attempt <= GENIUSPAY_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.warn(`[GeniusPay] Statut : retry #${attempt}/${GENIUSPAY_MAX_RETRIES}...`)
        await new Promise((r) => setTimeout(r, 1000))
      }
      const res = await fetchWithTimeout(`${GENIUSPAY_BASE_URL}/payments/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: geniuspayHeaders(),
        cache: 'no-store',
      })
      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        console.error(
          `[GeniusPay] Statut : reponse non-JSON (HTTP ${res.status}):`,
          text.slice(0, 300),
        )
        lastError = new Error(`Non-JSON response HTTP ${res.status}`)
        continue // retry
      }
      if (!res.ok || !data?.data) {
        console.error(
          `[GeniusPay] Statut echoue (HTTP ${res.status}) pour reference=${reference}:`,
          text.slice(0, 300),
        )
        if (res.status >= 500 || res.status === 429) {
          lastError = new Error(`HTTP ${res.status}`)
          continue // retry
        }
        return null // erreur client, pas de retry
      }
      const d = data.data
      return {
        id: String(d.id ?? ''),
        reference: String(d.reference ?? reference),
        status: String(d.status || 'pending').toLowerCase(),
        amount: Number(d.amount || 0),
        metadata: (d.metadata || {}) as Record<string, any>,
        raw: d,
      }
    } catch (netErr) {
      lastError = netErr
      const isAbort = netErr instanceof Error && netErr.name === 'AbortError'
      console.error(
        `[GeniusPay] Statut : ${isAbort ? 'timeout' : 'appel API injoignable'} (tentative ${attempt + 1}/${GENIUSPAY_MAX_RETRIES + 1}):`,
        isAbort ? `${GENIUSPAY_TIMEOUT_MS}ms depasse` : netErr,
      )
      continue
    }
  }
  console.error('[GeniusPay] Statut : echec definitif apres', GENIUSPAY_MAX_RETRIES + 1, 'tentatives pour', reference, ':', lastError)
  return null
}

// Normalise un statut GeniusPay vers notre vocabulaire interne
// ('completed' | 'pending' | 'cancelled').
export function normalizeGeniusPayStatus(raw: string): 'completed' | 'pending' | 'cancelled' {
  switch (raw) {
    case 'completed':
    case 'success':
    case 'paid':
    case 'approved':
    case 'transferred':
      return 'completed'
    case 'failed':
    case 'cancelled':
    case 'canceled':
    case 'expired':
    case 'refunded':
    case 'declined':
    case 'refused':
    case 'reversed':
      return 'cancelled'
    default:
      return 'pending'
  }
}