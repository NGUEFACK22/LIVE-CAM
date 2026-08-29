// ============================================================
// Frais GeniusPay reportes sur le client.
// Barème constaté sur le tableau de bord GeniusPay : 100 FCFA
// fixes + 1% du montant facturé au client.
// Le client paie donc un montant TOTAL A tel que le montant NET
// encaisse (ce qu'on crédite / le prix affiché) soit préservé :
//   net = A - (fixe + rate·A)   =>   A = (net + fixe) / (1 - rate)
// Module CLIENT-SAFE : aucun secret ici, utilisé aussi par les UI.
// ============================================================

export const GENIUSPAY_FEE_FIXED_XOF = 100
export const GENIUSPAY_FEE_RATE = 0.01

// Montant total à facturer au client pour un montant net donné.
// Arrondi au-dessus (ceil) pour ne jamais encaisser un net inférieur
// au prix affiché (ex: net 200 -> charge 304 -> net encaissé ~201).
export function geniusPayTotalToCharge(netAmountXof: number): number {
  const net = Math.round(Number(netAmountXof) || 0)
  if (net <= 0) return 0
  return Math.ceil((net + GENIUSPAY_FEE_FIXED_XOF) / (1 - GENIUSPAY_FEE_RATE))
}

// Frais facturés au client pour un montant net donné (= total - net).
export function geniusPayFeeFor(netAmountXof: number): number {
  const net = Math.round(Number(netAmountXof) || 0)
  if (net <= 0) return 0
  return geniusPayTotalToCharge(net) - net
}