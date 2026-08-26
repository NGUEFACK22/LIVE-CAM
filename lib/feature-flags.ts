'use client'

// Seule fonctionnalité autorisée: Live Swap
// Tout le reste du dashboard est bloqué avec message "Fonctionnalité bloquée"
export const ALLOWED_PATHS = [
  '/dashboard/live-swap',
  '/dashboard', // page d'accueil
  '/dashboard/plans', // paiement - autorisé
  '/dashboard/payment-success', // retour paiement
]

export function isPathAllowed(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/dashboard') return true
  if (path === '/dashboard/live-swap' || path.startsWith('/dashboard/live-swap/')) return true
  if (path === '/dashboard/plans' || path.startsWith('/dashboard/plans/')) return true
  if (path === '/dashboard/payment-success' || path.startsWith('/dashboard/payment-success/')) return true
  if (path.startsWith('/dashboard/')) return false
  return true
}

export function isPathBlocked(pathname: string): boolean {
  return !isPathAllowed(pathname)
}
