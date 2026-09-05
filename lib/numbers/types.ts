// Types partagés client/serveur pour ChapCam Numbers (sans secret ni import serveur).

export type ActivationStatus = 'waiting' | 'received' | 'cancelled' | 'expired'

export type Activation = {
  id: number
  provider: string
  countryCode: string
  serviceSlug: string
  serviceLabel: string
  phone: string
  priceXof: number
  status: ActivationStatus
  code: string | null
  fullSms: string | null
  createdAt: number
  expiresAt: number | null
}

export type Tx = {
  id: number
  kind: 'deposit' | 'purchase' | 'refund'
  amountXof: number
  method: string
  reference: string | null
  status: string
  createdAt: number
}

export type NumbersState = {
  /** Solde unifié en FCFA (points × 20). */
  balanceXof: number
  /** Solde unifié en POINTS (1 point = 20 FCFA) — mêmes crédits que les vidéos. */
  points: number
  activations: Activation[]
  transactions: Tx[]
}

export type ProviderQuote = { provider: string; priceXof: number }

export type QuoteResponse = {
  available: boolean
  priceXof: number | null
  cheapestProvider: string | null
  providerCount: number
  /** Taux de réussite SMS estimé (0-100) pour cette combinaison pays/service. */
  successRate: number | null
}

export function formatXOF(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' FCFA'
}

/** Qualité d'attribution d'un numéro : moins cher (auto) ou meilleur taux de réussite. */
export type BuyQuality = 'cheap' | 'premium'
