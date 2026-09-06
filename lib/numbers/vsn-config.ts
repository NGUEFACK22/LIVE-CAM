/**
 * Resolution de la cle API VirtualSMSNumbers (numeros virtuel), priorisee :
 *  1. Supabase (table app_config, RPC get_app_config) — modifiable a chaud
 *     sans rebuild, fiable meme quand la variable d'environnement Vercel est absente.
 *  2. Variables d'environnement (.env.local / VSN_API_KEY) — fallback.
 *
 * SECURITE : la cle ne quitte jamais le serveur. Rien n'est expose au client.
 */

import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type VsnKeyResolution = { key: string; source: 'supabase' | 'env' | 'none' }

let cached: VsnKeyResolution | null | undefined

/** Résout la clé VirtualSMSNumbers (mise en cache). N'échoue jamais bruyamment. */
export async function resolveVsnApiKey(): Promise<VsnKeyResolution> {
  if (cached) return cached

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_app_config', { p_key: 'vsn_api_key' })
    if (!error && typeof data === 'string' && data.trim().length > 0) {
      cached = { key: data.trim(), source: 'supabase' }
      return cached
    }
    if (error) {
      const isMissing =
        error.code === '42P01' ||
        /does not exist|function.*does not exist|not allowed/i.test(error.message || '')
      if (!isMissing) console.warn('[VSN Config] get_app_config failed:', error.message)
    }
  } catch (err: any) {
    const isMissing = /does not exist|function.*does not exist|not allowed/i.test(err?.message || String(err))
    if (!isMissing) console.warn('[VSN Config] Erreur lecture:', err?.message || err)
  }

  const envKey = process.env.VSN_API_KEY || ''
  cached = { key: envKey, source: envKey ? 'env' : 'none' }
  return cached
}