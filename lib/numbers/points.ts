// Conversion crédits <-> montant, partagée serveur + client (aucun import serveur).
//
// Solde UNIFIÉ ChapCam : subscriptions.points (Supabase).
//   1 point = 20 FCFA   (même convention que la recharge custom LIVECAM)
//
// Les points servent à la fois :
//   - aux vidéos (Live Swap : 1 point = 1 seconde),
//   - à l'achat de numéros virtuels (prix FCFA converti via xofToPoints).
// Les prix affichés en FCFA sont donc des multiples de 20 (cf. tierPriceXof),
// ce qui garantit une conversion toujours en nombre ENTIER de points.

export const FCFA_PER_POINT = 20

/** Convertit un solde en points vers son équivalent FCFA. */
export function pointsToXof(points: number): number {
  return Math.round(points) * FCFA_PER_POINT
}

/** Convertit un montant FCFA vers le nombre de points à débiter/créditer. */
export function xofToPoints(xof: number): number {
  return Math.round(xof / FCFA_PER_POINT)
}

/** Formatage court d'un solde en points (ex: "1 250 pts"). */
export function formatPoints(points: number): string {
  return (
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(points)) + ' pts'
  )
}