import { createDecartClient } from '@decartai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDecartKeys } from '@/lib/decart-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // 1. Verifier que l'utilisateur est authentifie
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.id) {
    return NextResponse.json(
      { error: 'Non authentifie. Connecte-toi pour utiliser le swap.' },
      { status: 401 }
    )
  }

  try {
    // Resoudre la cle Decart : Supabase d'abord (modifiable a chaud), .env en fallback.
    // Critique : les clients desktop deja installes ont .env.local fige avec
    // l'ancienne cle. Sans cette lecture dynamique, ils devraient tous
    // reinstaller l'app pour recuperer la nouvelle cle.
    const { apiKey, source } = await resolveDecartKeys()

    if (!apiKey) {
      console.error('[Decart Session] Aucune cle Decart utilisable (ni .env ni Supabase)')
      return NextResponse.json(
        { error: 'Service temporairement indisponible' },
        { status: 500 }
      )
    }

    const client = createDecartClient({ apiKey })

    const requestOrigin = request.headers.get('origin') || request.headers.get('referer')
    const allowedOriginsSet = new Set([
      'https://chapcam.com',
      'https://www.chapcam.com',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ])
    if (requestOrigin) {
      try {
        const parsed = new URL(requestOrigin).origin
        if (parsed && parsed !== 'null') allowedOriginsSet.add(parsed)
      } catch {
        // Ignorer si URL invalide
      }
    }

    // 2. Creer un token ephemere avec restrictions strictes
    const token = await client.tokens.create({
      expiresIn: 600, // 10 minutes max
      allowedModels: ['lucy-2.5', 'lucy-2.1'],
      allowedOrigins: Array.from(allowedOriginsSet),
      metadata: {
        userId: user.id,
        userEmail: user.email,
        sessionType: 'realtime-swap',
        createdAt: new Date().toISOString(),
        keySource: source,
      }
    })

    console.log(`[Decart Session] Session creee pour user ${user.id} | source=${source}`)

    return NextResponse.json({
      success: true,
      token: token.apiKey || token.token,
      expiresAt: token.expiresAt,
      userId: user.id
    })
  } catch (error: any) {
    console.error('[Decart Session] Error:', error)
    return NextResponse.json(
      { error: 'Impossible de demarrer la session. Reessaie.', details: error.message },
      { status: 500 }
    )
  }
}
