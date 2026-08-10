import { NextRequest, NextResponse } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'
import { requireAuth } from '@/lib/api-security'

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET
// Endpoint GPU utilise par le hook use-cloud-swap (meme defaut que lib/gpu-pool).
const GPU_ENDPOINT = process.env.RUNPOD_ENDPOINT_FACE || 'https://api.runpod.ai/v2/chapcam-swap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cree un token LiveKit pour la session cloud swap.
// Securite : l'identite provient de la session (jamais du body), et le token
// ne peut etre cree que par un utilisateur authentifie.
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { user } = authResult

    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error('[LiveKit] Missing API credentials')
      return NextResponse.json(
        { success: false, error: 'LiveKit non configure' },
        { status: 500 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const participantName = String(body.participantName || 'ChapCam Cloud Swap')
    const roomName = String(body.roomName || '').trim() || `chapcam-${user.id}-${Date.now()}`

    // Creer un token d'acces (identite = utilisateur verifie)
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      name: participantName,
      ttl: '6h', // Token valide 6 heures
    })

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: body.isPublisher !== false,
      canSubscribe: true,
      canPublishData: true,
    })

    const token = await at.toJwt()

    return NextResponse.json({
      success: true,
      token,
      roomName,
      wsUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://chapcam.livekit.cloud',
      // Le hook use-cloud-swap attend `endpoint` (endpoint GPU RunPod).
      endpoint: GPU_ENDPOINT,
    })
  } catch (error) {
    console.error('[LiveKit] Error creating token:', error)
    return NextResponse.json(
      { success: false, error: 'Erreur creation token' },
      { status: 500 }
    )
  }
}
