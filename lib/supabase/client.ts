'use client'

import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'

let client: ReturnType<typeof createBrowserClient> | null = null
let electronClient: ReturnType<typeof createSupabaseJsClient> | null = null

function isElectronRenderer(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: { isElectron: boolean } }).electronAPI?.isElectron
}

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être définies ' +
        'dans .env.local (elles sont inlinées au build). Voir .env.example.',
    )
  }

  // Electron renderer : utiliser supabase-js avec localStorage (pas de cookies/CORS credentials)
  // Le createBrowserClient de @supabase/ssr fait des fetch avec credentials:'include' qui
  // échouent dans Electron si le patch CORS n'a pas encore pris effet ou si le port est
  // dynamique. Le client supabase-js persistant en localStorage contourne le problème.
  if (isElectronRenderer()) {
    if (electronClient) return electronClient as unknown as ReturnType<typeof createBrowserClient>
    electronClient = createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
    return electronClient as unknown as ReturnType<typeof createBrowserClient>
  }

  if (client) return client

  client = createBrowserClient(supabaseUrl, supabaseAnonKey)

  return client
}
