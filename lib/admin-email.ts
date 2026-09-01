// Constantes partagées pour identifier les administrateurs
export const ADMIN_EMAIL = 'admin@chapcam.live'
export const ADMIN_EMAILS = ['admin@chapcam.live']

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const lower = email.trim().toLowerCase()
  return ADMIN_EMAILS.some((a) => a.toLowerCase() === lower)
}
