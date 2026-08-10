import { createDecartClient } from '@decartai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveWatermarkForUser, pickDecartApiKey } from '@/lib/watermark'
import { resolveDecartKeys } from '@/lib/decart-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Génère un token mock pour le mode démo local (sans clé Decart)
function createMockToken(userId: string, email: string | undefined): string {
  const payload = {
    sub: userId,
    email,
    mock: true,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1h
    iat: Math.floor(Date.now() / 1000)
  }
  // Simple base64 encoding (pas de vraie signature pour le mock)
  return 'mock_' + Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export async function GET(request: NextRequest) {
  // 1. Verifier que l'utilisateur est authentifie
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.id) {
    return NextResponse.json(
      { error: 'Non authentifie. Connecte-toi pour utiliser le swap.' },
      { status: 401 }
    )
  }

  // 2. Resoudre les cles Decart : Supabase d'abord, .env en fallback.
  //    Permet de changer la cle pour tous les clients (web + desktop deja
  //    installes) sans rebuild, en une seule requete SQL.
  const { apiKey: decartApiKey, apiKeyNoWatermark: decartNoWatermarkKey, source } =
    await resolveDecartKeys()

  // NOTE: Mode démo désactivé - toujours nécessiter une clé Decart valide
  // pour le swap IA réel
  if (!decartApiKey && !decartNoWatermarkKey) {
    return NextResponse.json(
      {
        error:
          'Clé API Decart non configurée. Ajoutez DECART_API_KEY dans .env.local ou dans Supabase (table app_config).',
      },
      { status: 500 },
    )
  }

  // MODE PRODUCTION : clé Decart configurée
  const decision = await resolveWatermarkForUser(user.id)

  // Trouver la bonne cle selon la decision de watermark.
  // pickDecartApiKey lit process.env : on l'adapte pour preferer nos cles
  // resolues (qui peuvent venir de Supabase). Si la cle Supabase manque, on
  // retombe sur process.env deja lu par pickDecartApiKey.
  let apiKey: string | undefined
  let usedNoWatermark = false

  if (decision.noWatermark) {
    if (decartNoWatermarkKey) {
      apiKey = decartNoWatermarkKey
      usedNoWatermark = true
    } else if (decartApiKey) {
      apiKey = decartApiKey
      usedNoWatermark = false
    }
  } else {
    if (decartApiKey) {
      apiKey = decartApiKey
      usedNoWatermark = false
    } else if (decartNoWatermarkKey) {
      apiKey = decartNoWatermarkKey
      usedNoWatermark = true
    }
  }

  if (!apiKey) {
    console.error('[Decart Token] Aucune cle Decart utilisable (ni .env ni Supabase)')
    return NextResponse.json(
      { error: 'Service temporairement indisponible' },
      { status: 500 }
    )
  }

  try {
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

    // Ne pas restreindre allowedOrigins en local/dev ou en mode gratuit pour eviter les erreurs
    // "signaling: server error received" produites par les origines Electron (file://) ou localhost variés.
    const isProdDomain = process.env.NODE_ENV === 'production' && process.env.VERCEL
    const token = await client.tokens.create({
      expiresIn: 600,
      allowedModels: ['lucy-2.5', 'lucy-2.1', 'lucy-restyle-2', 'lucy-vton-2'],
      allowedOrigins: isProdDomain ? Array.from(allowedOriginsSet) : undefined,
      metadata: {
        userId: user.id,
        userEmail: user.email,
        noWatermark: usedNoWatermark,
        createdAt: new Date().toISOString(),
        keySource: source, // Tracabilite pour debug
      }
    })

    console.log(
      `[Decart Token] Token créé pour user ${user.id} | plan=${decision.plan || 'none'} | ` +
      `noWatermark=${usedNoWatermark} (${decision.reason}) | source=${source}`
    )

    return NextResponse.json({
      success: true,
      token: token.apiKey,
      apiKey: token.apiKey,
      expiresAt: token.expiresAt,
      userId: user.id,
      noWatermark: usedNoWatermark
    })
  } catch (error: any) {
    console.error('[Decart Token] Error:', error.message)
    return NextResponse.json(
      { error: 'Impossible de démarrer le swap. Réessaie.', details: error.message },
      { status: 500 }
    )
  }
}
