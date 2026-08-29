'use client'

import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseJsClient, type Session } from '@supabase/supabase-js'

let client: ReturnType<typeof createBrowserClient> | null = null
let electronClient: ReturnType<typeof createSupabaseJsClient> | null = null

// ---------------------------------------------------------------------------
// Session Electron -> cookies (format @supabase/ssr)
// Le client renderer Electron utilise supabase-js avec localStorage (fetch SANS
// credentials:'include' -> aucun probleme CORS "Failed to fetch"). Mais le
// serveur Next (proxy.ts + lib/supabase/server.ts) lit la session depuis les
// COOKIES (sb-<ref>-auth-token). Sans cette sync, apres connexion le proxy ne
// voit aucune session et redirige /dashboard vers /auth/login ("ca reste sur
// la connexion"). On re-ecrit donc la session dans les cookies exactement
// comme le ferait createBrowserClient (@supabase/ssr, cookieEncoding base64url).
// ---------------------------------------------------------------------------

const BASE64_PREFIX = 'base64-'
const MAX_CHUNK_SIZE = 3180

function getProjectRef(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    return new URL(url).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

// Encode UTF-8 -> Base64URL (sans padding), meme resultat que
// stringToBase64URL de @supabase/ssr.
function stringToBase64URL(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Replique createChunks de @supabase/ssr (chunk 3180, noms <key>.<i>).
function createChunks(
  key: string,
  value: string,
): { name: string; value: string }[] {
  let encodedValue = encodeURIComponent(value)
  if (encodedValue.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value }]
  }
  const chunks: string[] = []
  while (encodedValue.length > 0) {
    let encodedChunkHead = encodedValue.slice(0, MAX_CHUNK_SIZE)
    const lastEscapePos = encodedChunkHead.lastIndexOf('%')
    if (lastEscapePos > MAX_CHUNK_SIZE - 3) {
      encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos)
    }
    let valueHead = ''
    while (encodedChunkHead.length > 0) {
      try {
        valueHead = decodeURIComponent(encodedChunkHead)
        break
      } catch {
        if (encodedChunkHead.at(-3) === '%' && encodedChunkHead.length > 3) {
          encodedChunkHead = encodedChunkHead.slice(0, -3)
        } else {
          throw new Error('Chunk splitting failed')
        }
      }
    }
    chunks.push(valueHead)
    encodedValue = encodedValue.slice(encodedChunkHead.length)
  }
  return chunks.map((value, i) => ({ name: `${key}.${i}`, value }))
}

function authCookieName(): string {
  const ref = getProjectRef()
  return `sb-${ref || 'unknown'}-auth-token`
}

// Ecrit la session dans les cookies (avec nettoyage des vieux chunks).
function writeSessionCookies(session: Session): void {
  if (typeof document === 'undefined') return
  const key = authCookieName()
  const raw = BASE64_PREFIX + stringToBase64URL(JSON.stringify(session))
  const toSet = createChunks(key, raw)
  const toKeep = new Set(toSet.map((c) => c.name))
  // Supprime les anciens chunks restants (la session a change de taille)
  for (let i = 0; i < 10; i++) {
    const oldName = `${key}.${i}`
    if (!toKeep.has(oldName)) {
      document.cookie = `${oldName}=; Path=/; Max-Age=0; SameSite=Lax`
    }
  }
  for (const c of toSet) {
    document.cookie = `${c.name}=${c.value}; Path=/; Max-Age=34560000; SameSite=Lax`
  }
}

function clearSessionCookies(): void {
  if (typeof document === 'undefined') return
  const key = authCookieName()
  document.cookie = `${key}=; Path=/; Max-Age=0; SameSite=Lax`
  for (let i = 0; i < 10; i++) {
    document.cookie = `${key}.${i}=; Path=/; Max-Age=0; SameSite=Lax`
  }
}

function isElectronRenderer(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as unknown as { electronAPI?: { isElectron: boolean } }).electronAPI?.isElectron
  )
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

  // Electron renderer : supabase-js + localStorage. Le fetch vers Supabase se
  // fait SANS credentials:'include' (createBrowserClient de @supabase/ssr le
  // fait, ce qui donne "Failed to fetch" en Electron malgre le patch CORS).
  // La session est ensuite re-ecrite dans les cookies (writeSessionCookies)
  // pour que le middleware et le serveur SSR voient l'utilisateur connecte.
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
    // Synchronise la session vers les cookies a chaque evenement auth
    // (login, signup, token refresh) et sync initiale au chargement.
    try {
      electronClient.auth.onAuthStateChange((_event, session2) => {
        if (session2) {
          writeSessionCookies(session2)
        } else {
          clearSessionCookies()
        }
      })
      electronClient.auth
        .getSession()
        .then(({ data }) => {
          if (data.session) writeSessionCookies(data.session)
        })
        .catch(() => {})
    } catch {
      // Non bloquant : le login re-ecrira les cookies juste apres connexion.
    }
    return electronClient as unknown as ReturnType<typeof createBrowserClient>
  }

  if (client) return client

  client = createBrowserClient(supabaseUrl, supabaseAnonKey)

  return client
}