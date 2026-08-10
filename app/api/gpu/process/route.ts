import { NextRequest, NextResponse } from 'next/server'
import { getGPUPoolManager } from '@/lib/gpu-pool'
import { requireAuth } from '@/lib/api-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Traite UNE frame via le pool GPU (use-cloud-swap.ts -> /api/gpu/process).
// Securite : le userId vient de la session, jamais du body.
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { user } = authResult

    const body = await request.json().catch(() => ({}))
    const frame = String(body.frame || '')
    const avatarUrl = String(body.avatarUrl || '')
    const quality = (body.quality as '480p' | '720p' | '1080p') || '720p'

    if (!frame) {
      return NextResponse.json(
        { success: false, error: 'Frame manquante' },
        { status: 400 }
      )
    }

    const gpuPool = getGPUPoolManager()

    // Allouer (ou recuperer) l'endpoint pour cet utilisateur, puis traiter la frame.
    const allocation = await gpuPool.allocateGPU({
      userId: user.id,
      tier: 'free',
      avatarUrl,
      quality,
      fps: 15,
    })

    if (!allocation.success || !allocation.endpoint) {
      return NextResponse.json(
        { success: false, error: allocation.error || 'Aucun GPU disponible' },
        { status: 503 }
      )
    }

    const result = await gpuPool.processFrame(
      allocation.endpoint,
      frame,
      avatarUrl,
      { userId: user.id, tier: 'free', avatarUrl, quality, fps: 15 },
    )

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Echec du traitement GPU' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      processedFrame: result.processedFrame,
      latency: result.latency,
      gpuLoad: 0, // le pool GPU expose la charge via /api/swap/cloud (GET)
    })
  } catch (error) {
    console.error('[GPU Process] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}
