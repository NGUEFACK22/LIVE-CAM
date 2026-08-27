'use client'

// Seule fonctionnalité autorisée: Live Swap
// Tout le reste du dashboard est bloqué avec message "Fonctionnalité bloquée"
export const ALLOWED_PATHS = [
  '/dashboard/live-swap', // Live Swap - toujours autorisé
  '/dashboard', // Accueil dashboard (résumé compte)
  '/dashboard/plans', // Recharger crédits
  '/dashboard/payment-success', // Retour paiement
  '/dashboard/settings', // Espace compte (profil, mot de passe)
  '/dashboard/avatars', // Mes avatars (lié au compte)
  '/dashboard/stats', // Statistiques compte
]

export function isPathAllowed(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/dashboard') return true
  if (path === '/dashboard/live-swap' || path.startsWith('/dashboard/live-swap/')) return true
  if (path === '/dashboard/plans' || path.startsWith('/dashboard/plans/')) return true
  if (path === '/dashboard/payment-success' || path.startsWith('/dashboard/payment-success/')) return true
  if (path === '/dashboard/settings' || path.startsWith('/dashboard/settings/')) return true
  if (path === '/dashboard/avatars' || path.startsWith('/dashboard/avatars/')) return true
  if (path === '/dashboard/stats' || path.startsWith('/dashboard/stats/')) return true
  if (path.startsWith('/dashboard/')) return false
  return true
}

export function isPathBlocked(pathname: string): boolean {
  return !isPathAllowed(pathname)
}
