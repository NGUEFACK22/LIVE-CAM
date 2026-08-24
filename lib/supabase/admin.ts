import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { isFreeLiveSwap } from '@/lib/free-mode'

// Client admin (service_role) pour le projet ChapCam.
// A utiliser UNIQUEMENT cote serveur (route handlers). Ne jamais importer cote client.
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL manquante. Configurez-la dans .env.local (voir .env.example).',
    )
  }

  // Mode gratuit : le service_role n'est pas requis (Live Swap illimité sans points).
  // On retombe sur la clé anon pour ne pas faire crasher les routes qui appellent
  // encore createAdminClient. Les routes critiques (decart-token, live/session)
  // contournent déjà l'admin en free-mode — voir app/api/live/session/route.ts:34.
  if (!serviceKey) {
    if (isFreeLiveSwap()) {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!anonKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY manquante en mode gratuit.')
      }
      console.warn('[supabase/admin] SUPABASE_SERVICE_ROLE_KEY absente — fallback anon en mode gratuit (isFreeLiveSwap=true). Les routes admin/paiements renverront 403/500.')
      return createSupabaseClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    }
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY manquante. Ajoute la cle service_role dans les variables d\'environnement.',
    )
  }

  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
