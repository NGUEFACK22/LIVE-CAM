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

    // Un utilisateur peut aussi demarrer s'il a une fenetre active, des
    // credits sessions (pending_windows) OU des points restants (ancien mode
    // facturation a la seconde). On accepte le mode points comme fallback.
    let canStart = state.canStart
    let pointsBalance = 0
    if (!canStart) {
      const { data: sub } = await admin
        .from('subscriptions')
        .select('points')
        .eq('user_id', user.id)
        .maybeSingle()
      pointsBalance = sub?.points ?? 0
      canStart = pointsBalance > 0
    }

    if (!canStart) {
      return NextResponse.json(
        {
          canStart: false,
          error:
            "Vous n'avez plus de crédits Live Swap. Achetez des crédits pour continuer.",
          mode: 'none',
          pendingWindows: state.pendingWindows,
          points: pointsBalance,
        },
        { status: 403 },
      )
    }

    // Check if GPU is configured (for trial/paid modes that use GPU workers)
    const pool = state.mode === 'trial' ? 'trial' : 'default'
    const gpuConfigured = isGpuConfigured(pool)

    return NextResponse.json({
      canStart: true,
      mode: state.canStart ? state.mode : 'paid',
      secondsRemaining: state.canStart ? state.secondsRemaining : pointsBalance,
      windowExpiresAt: state.windowExpiresAt,
      pendingWindows: state.pendingWindows,
      points: pointsBalance,
      gpuConfigured,
      pool,
    })
  } catch (err: any) {
    console.error('[live/access] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
