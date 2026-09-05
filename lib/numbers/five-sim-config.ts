/**
 * Resolution de la cle API 5sim, priorisee :
 *  1. Supabase (table app_config, RPC get_app_config) — modifiable a chaud
 *     sans rebuild, fiable meme quand la variable d'env Vercel est absente.
 *  2. Variables d'environnement (.env.local) — fallback.
 *
 * SECURITE : la cle ne quitte jamais le serveur. Rien n'est expose au client.
 */

import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type FiveSimKeyResolution = { key: string; source: 'supabase' | 'env' | 'none' }

let cached: FiveSimKeyResolution | null | undefined

/** Résout la clé 5sim (mise en cache). N'échoue jamais bruyamment. */
export async function resolveFiveSimApiKey(): Promise<FiveSimKeyResolution> {
  if (cached) return cached

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_app_config', { p_key: 'five_sim_api_key' })
    if (!error && typeof data === 'string' && data.trim().length > 0) {
      cached = { key: data.trim(), source: 'supabase' }
      return cached
    }
    if (error) {
      const isMissing =
        error.code === '42P01' ||
        /does not exist|function.*does not exist|not allowed/i.test(error.message || '')
      if (!isMissing) console.warn('[5sim Config] get_app_config failed:', error.message)
    }
  } catch (err: any) {
    const isMissing = /does not exist|function.*does not exist|not allowed/i.test(err?.message || String(err))
    if (!isMissing) console.warn('[5sim Config] Erreur lecture:', err?.message || err)
  }

  const envKey = process.env.FIVE_SIM_API_KEY || ''
  cached = { key: envKey, source: envKey ? 'env' : 'none' }
  return cached
}