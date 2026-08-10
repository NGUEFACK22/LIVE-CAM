import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureLiveAccess, computeState, isGpuConfigured } from '@/lib/live-access'
import { FREE_LIVE_SECONDS, isFreeLiveSwap } from '@/lib/free-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET : Check if user has live swap access (for Decart SDK path)
// Returns access status without consuming a window or starting GPU connection
export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Non authentifie.' }, { status: 401 })
    }

    // Free mode: unlimited access (prioritaire sur toute expiration d'essai/paiement).
    // Verifie AVANT createAdminClient() pour que le build embarque (sans
    // SUPABASE_SERVICE_ROLE_KEY) fonctionne hors ligne.
    if (isFreeLiveSwap()) {
      return NextResponse.json({
        canStart: true,
        mode: 'free',
        secondsRemaining: FREE_LIVE_SECONDS,
        windowExpiresAt: null,
      })
    }

    const admin = createAdminClient()
    const row = await ensureLiveAccess(admin, user.id)
    const state = computeState(row)

    if (!state.canStart) {
      return NextResponse.json(
        {
          canStart: false,
          error:
            "La periode d'essai gratuit de 2 minutes a pris fin il y a quelques jours. Achetez l'offre Live Pro pour continuer.",
          mode: 'none',
        },
        { status: 403 },
      )
    }

    // Check if GPU is configured (for trial/paid modes that use GPU workers)
    const pool = state.mode === 'trial' ? 'trial' : 'default'
    const gpuConfigured = isGpuConfigured(pool)

    return NextResponse.json({
      canStart: true,
      mode: state.mode,
      secondsRemaining: state.secondsRemaining,
      windowExpiresAt: state.windowExpiresAt,
      gpuConfigured,
      pool,
    })
  } catch (err: any) {
    console.error('[live/access] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
