import { NextRequest, NextResponse } from 'next/server'
import { getGPUPoolManager } from '@/lib/gpu-pool'
import { requireAuth } from '@/lib/api-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Libere l'allocation GPU de l'utilisateur connecte (use-cloud-swap.ts ->
// /api/gpu/release). Securite : userId issu de la session, jamais du body.
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { user } = authResult

    const gpuPool = getGPUPoolManager()
    await gpuPool.releaseGPU(user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[GPU Release] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}
