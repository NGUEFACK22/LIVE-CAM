/**
 * Mode gratuit ChapCam — Live Swap sans abonnement ni points.
 *
 * Objectif : restaurer l'outil de transformation d'apparence (appels WhatsApp,
 * TikTok, Zoom, etc.) sans passer par un forfait payant.
 *
 * Activation (mode gratuit/illimite) :
 *   NEXT_PUBLIC_FREE_LIVE_SWAP=true
 *
 * Par defaut le mode gratuit est DESACTIVE (re-monetisation active). En production,
 * une absence de variable declenche un avertissement clair.
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
    // Par defaut : payant (grace au systeme de points/forfaits).
  // Garde-fou : en production, on emet un avertissement une seule fois si
  // la variable n'est PAS explicite. Le produit est alors en mode PAYANT —
  // les utilisateurs sont factures normalement via le systeme de points.
  // Pour activer le mode gratuit/illimite, definir NEXT_PUBLIC_FREE_LIVE_SWAP=true.
  if (process.env.NODE_ENV === 'production' && !warnedProd) {
    warnedProd = true
    if (process.env.NEXT_PUBLIC_FREE_LIVE_SWAP !== 'true') {
      console.warn(
        '[free-mode] ATTENTION : NEXT_PUBLIC_FREE_LIVE_SWAP n\'est pas défini à "true" en production. ' +
          'Le Live Swap est en mode PAYANT — les utilisateurs sont facturés via le système de points/forfaits. ' +
          'Définir NEXT_PUBLIC_FREE_LIVE_SWAP=true pour activer le mode gratuit/illimité.',
      )
    }
  }
  return false
}

/** Solde affiche / renvoye par l'API en mode gratuit. */
export const FREE_UNLIMITED_POINTS = 999_999

/** Duree "illimitee" pour les sessions Live GPU (secondes). */
export const FREE_LIVE_SECONDS = 24 * 60 * 60
