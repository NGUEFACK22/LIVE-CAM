// Evenement temps reel : synchronisation du solde de points affiche dans la
// sidebar pendant une session Live Swap (deduction de 1 point/seconde).
//
// La page Live Swap emet l'evenement a chaque tick (decrement local fluide)
// et apres chaque synchronisation serveur (solde reel en base). La sidebar
// (composant client du layout) l'ecoute et met a jour son affichage sans
// recharger le layout serveur, qui ne fournit que la valeur initiale.

export const POINTS_UPDATE_EVENT = 'chapcam:points-update'

export interface PointsUpdateDetail {
  points: number
  total?: number
}

export function emitPointsUpdate(points: number, total?: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PointsUpdateDetail>(POINTS_UPDATE_EVENT, {
      detail: { points, total },
    }),
  )
}