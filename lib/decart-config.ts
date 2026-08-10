/**
 * Resolution de la cle API Decart, priorisee :
 *  1. Supabase (table app_config) — permet de changer la cle pour TOUS les
 *     clients (web + desktop) SANS rebuild. Critique pour les versions deja
 *     installees qui ont .env.local fige.
 *  2. Variables d'environnement (.env.local) — fallback si Supabase n'a pas
 *     la cle, est inaccessible, ou n'a pas encore ete peuple.
 *
 * SECURITE : la cle ne quitte jamais le serveur. Le client recoit juste un
 * token ephemere (10 min max) signe par la cle — jamais la cle elle-meme.
 */

import { createClient } from '@/lib/supabase/server'

/**
 * Lit une valeur app_config via la fonction RPC get_app_config.
 * Renvoie null si la table n'existe pas encore, ou si la cle est absente.
 * N'echoue jamais de facon bruyante (fallback silencieux sur .env).
 */
async function readConfigFromSupabase(
  keyName: 'decart_api_key' | 'decart_api_key_no_watermark',
): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_app_config', { p_key: keyName })

    if (error) {
      // 42P01 = table app_config absente (non peuplee) — normal au premier deploiement
      const isMissing =
        error.code === '42P01' ||
        /does not exist|function.*does not exist/i.test(error.message || '')
      if (!isMissing) {
        console.warn(`[Decart Config] RPC get_app_config(${keyName}) failed:`, error.message)
      }
      return null
    }

    if (typeof data === 'string' && data.trim().length > 0) {
      return data.trim()
    }

    return null
  } catch (err: any) {
    const isMissing =
      /does not exist|relation.*does not exist|function.*does not exist/i.test(
        err?.message || String(err),
      )
    if (!isMissing) {
      console.warn(`[Decart Config] Erreur lecture ${keyName}:`, err?.message || err)
    }
    return null
  }
}

export interface ResolvedDecartKeys {
  /** Cle Decart principale (avec watermark) */
  apiKey: string | undefined
  /** Cle Decart sans watermark */
  apiKeyNoWatermark: string | undefined
  /** 'supabase' | 'env' | 'none' — pour les logs de debug */
  source: 'supabase' | 'env' | 'none'
}

/**
 * Resout TOUTES les cles Decart (avec et sans watermark) en une seule passe.
 * Lite d'abord Supabase, puis retombe sur process.env.
 *
 * Utilise par /api/decart-token, /api/decart-session, et toute route
 * qui a besoin d'appeler Decart.
 */
export async function resolveDecartKeys(): Promise<ResolvedDecartKeys> {
  const [supabaseKey, supabaseNoWatermarkKey] = await Promise.all([
    readConfigFromSupabase('decart_api_key'),
    readConfigFromSupabase('decart_api_key_no_watermark'),
  ])

  const apiKey = supabaseKey || process.env.DECART_API_KEY
  const apiKeyNoWatermark = supabaseNoWatermarkKey || process.env.DECART_API_KEY_NO_WATERMARK

  let source: ResolvedDecartKeys['source'] = 'none'
  if (supabaseKey || supabaseNoWatermarkKey) {
    source = 'supabase'
  } else if (apiKey || apiKeyNoWatermark) {
    source = 'env'
  }

  if (source === 'supabase') {
    console.log('[Decart Config] Cles lues depuis Supabase (prioritaire, modifiables a chaud)')
  }

  return { apiKey, apiKeyNoWatermark, source }
}
