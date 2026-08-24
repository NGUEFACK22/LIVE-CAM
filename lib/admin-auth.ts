import { createClient } from '@/lib/supabase/server'
import { ADMIN_EMAIL } from '@/lib/admin-email'

export { ADMIN_EMAIL }

// Verifie que la requete provient bien de l'admin connecte.
// Le proxy (proxy.ts, ex-middleware) protege deja /api/admin en premiere
// couche (utilisateur connecte + email admin), mais chaque route admin
// rappelle ceci en defense en profondeur.
export async function isAdminRequest(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return !!user && user.email === ADMIN_EMAIL
  } catch {
    return false
  }
}
