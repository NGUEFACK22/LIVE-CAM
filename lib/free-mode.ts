/**
 * Mode gratuit ChapCam — Live Swap sans abonnement ni points.
 *
 * Objectif : restaurer l'outil de transformation d'apparence (appels WhatsApp,
 * TikTok, Zoom, etc.) sans passer par un forfait payant.
 *
 * Desactivation (re-monetisation) :
 *   NEXT_PUBLIC_FREE_LIVE_SWAP=false
 *
 * Par defaut le mode gratuit est ACTIVE (le produit est gratuit et illimite
 * pour le moment ; on pourra le desactiver via la variable d'environnement).
 */

function envFlag(value: string | undefined): boolean | null {
  if (value === undefined || value === '') return null
  const v = value.trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true
  return null
}

let warnedProd = false

/** Live Swap illimite, sans deduction de points ni fenetre payante. */
export function isFreeLiveSwap(): boolean {
  // Public (client + serveur) prioritaire, puis flag serveur seul.
  const pub = envFlag(process.env.NEXT_PUBLIC_FREE_LIVE_SWAP)
  if (pub !== null) return pub
  const srv = envFlag(process.env.FREE_LIVE_SWAP)
  if (srv !== null) return srv
  // Defaut : gratuit et illimite (produit en lancement).
  // Garde-fou : en production, si la variable n'est PAS explicitement definie,
  // on emet un avertissement clair une seule fois — le produit est alors
  // gratuit et illimite, et les forfaits payants sont contournes.
  if (process.env.NODE_ENV === 'production' && !warnedProd) {
    warnedProd = true
    console.warn(
      '[free-mode] ATTENTION : NEXT_PUBLIC_FREE_LIVE_SWAP n\'est pas défini en production. ' +
        'Le Live Swap / Face Swap est GRATUIT et ILLIMITÉ pour tous les utilisateurs. ' +
        'Mettez NEXT_PUBLIC_FREE_LIVE_SWAP=false dans l\'environnement pour réactiver les forfaits/points.',
    )
  }
  return true
}

/** Solde affiche / renvoye par l'API en mode gratuit. */
export const FREE_UNLIMITED_POINTS = 999_999

/** Duree "illimitee" pour les sessions Live GPU (secondes). */
export const FREE_LIVE_SECONDS = 24 * 60 * 60
