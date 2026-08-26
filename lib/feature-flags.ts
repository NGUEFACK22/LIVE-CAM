'use client'

// Seule fonctionnalité autorisée: Live Swap
// Tout le reste du dashboard est bloqué avec message "Fonctionnalité bloquée"
export const ALLOWED_PATHS = [
  '/dashboard/live-swap',
  '/dashboard', // page d'accueil dashboard -> redirige vers live-swap, pas bloquée
]

export function isPathAllowed(pathname: string): boolean {
  // Normaliser: enlever trailing slash
  const path = pathname.replace(/\/$/, '') || '/'
  // Autoriser exactement /dashboard et /dashboard/live-swap (+ sous-chemins)
  if (path === '/dashboard') return true
  if (path === '/dashboard/live-swap' || path.startsWith('/dashboard/live-swap/')) return true
  // Tout le reste sous /dashboard est bloqué
  if (path.startsWith('/dashboard/')) return false
  // Hors dashboard (auth, home, etc.) autorisé
  return true
}

export function isPathBlocked(pathname: string): boolean {
  return !isPathAllowed(pathname)
}
