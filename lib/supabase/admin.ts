import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

  if (!serviceKey) {
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
