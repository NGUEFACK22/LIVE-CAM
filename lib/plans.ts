// Source de verite des formules d'abonnement ChapCam.
// Utilise a la fois par la page /dashboard/plans et les routes API.

export type PlanId = 'starter' | 'standard' | 'premium' | 'ultimate' | 'vipdebout'

// Statut du logo (watermark) par forfait :
// - 'with'   : rendu AVEC logo ChapCam (Starter, Standard)
// - 'manual' : sans logo, active manuellement sur demande (Premium 50.000 F)
// - 'auto'   : sans logo automatiquement inclus (Ultimate 85.000 F)
export type WatermarkStatus = 'with' | 'manual' | 'auto'

export interface PlanConfig {
  id: PlanId
  name: string
  duration: string
  durationDays: number
  price: number
  oldPrice: number
  discount: number
  points: number
  minutes: string
  features: string[]
  popular: boolean
  // Forfait mis en avant (agrandi + halo). Reserve a Premium et VIP PRO.
  highlight: boolean
  // Forfait le plus avantageux : affiche le badge "MEILLEURE OFFRE". Reserve au VIP PRO.
  bestOffer: boolean
  watermark: WatermarkStatus
}

export const PLANS: PlanConfig[] = []

export function getPlan(id: string): PlanConfig | undefined {
  return PLANS.find((p) => p.id === id)
}

// --- Quota du service proxy "Navigation Sécurisée" ---
// Choix rentable : le quota de données proxy est un POOL UNIQUE partagé entre
// tous les pays, dimensionné selon le forfait payé. Sans forfait actif = 0 Go.
// (Évite l'abus du "10 Go par pays activé".)
export const PROXY_QUOTA_GB: Record<PlanId, number> = {
  starter: 2,
  standard: 15,
  premium: 50,
  ultimate: 120,
  vipdebout: 200,
}

/** Quota proxy (Go) accordé par un forfait. Retourne 0 si forfait inconnu/absent. */
export function proxyQuotaForPlan(planId: string | null | undefined): number {
  if (!planId) return 0
  return PROXY_QUOTA_GB[planId as PlanId] ?? 0
}
