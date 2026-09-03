import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ensureLiveAccess,
  computeState,
  liveOfferWindowMinutes,
} from '@/lib/live-access'
import { FREE_LIVE_SECONDS, isFreeLiveSwap } from '@/lib/free-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST : demarre une session Live.
// - consomme une fenetre payee si necessaire (pending -> active)
// - sinon utilise l'essai gratuit
// Renvoie le mode + le temps restant + la connexion GPU (wsUrl + token signe).
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Non authentifie.' }, { status: 401 })
    }

    // Mode gratuit : pas de fenetre payante ni d'essai, duree illimitee.
    // (Désactivé pour l'instant - GPU non configuré)
    if (isFreeLiveSwap()) {
      return NextResponse.json({
        configured: true,
        mode: 'paid',
        secondsRemaining: FREE_LIVE_SECONDS,
        windowExpiresAt: null,
        freeMode: true,
        message: 'Live Swap gratuit désactivé.'
      })
    }

    const admin = createAdminClient()
    const row = await ensureLiveAccess(admin, user.id)
    const state = computeState(row)

    if (!state.canStart) {
      return NextResponse.json(
        {
          error:
            "La periode d'essai gratuit de 2 minutes a pris fin il y a quelques jours. Achetez l'offre Live Pro pour continuer.",
          mode: 'none',
        },
        { status: 403 },
      )
    }

    // Aiguillage moteur : l'essai gratuit (trial) utilise le pool PersonaLive,
    // les fenetres payantes (paid/ready) gardent le pool par defaut (InsightFace).
    const pool = state.mode === 'trial' ? 'trial' : 'default'

    // NOTE: GPU check removed for simplified setup - Live Swap sans GPU
    // Si vous avez besoin du GPU, ajoutez LIVE_GPU_WS_URL et LIVE_GPU_SHARED_SECRET
    // dans .env.local et lancez python server.py dans scripts/live-gpu-worker/

    // Le moteur repond : on peut maintenant consommer la fenetre / lancer le decompte.
    const now = new Date()
    let mode = state.mode
    let secondsRemaining = state.secondsRemaining
    let windowExpiresAt = state.windowExpiresAt

    // Consommer un crédit à chaque lancement si l'utilisateur en a
    if (row.pending_windows > 0) {
      // Demarrer une fenetre payee : pending_windows-- et active_window_expires_at = now + 15 min
      const minutes = liveOfferWindowMinutes('live15')
      const expires = new Date(now.getTime() + minutes * 60 * 1000)
      await admin
        .from('live_access')
        .update({
          pending_windows: Math.max(0, row.pending_windows - 1),
          active_window_expires_at: expires.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('user_id', user.id)
      mode = 'paid'
      secondsRemaining = minutes * 60
      windowExpiresAt = expires.toISOString()
    } else if (state.mode === 'trial') {
      // Marquer le debut du decompte d'essai
      await admin
        .from('live_access')
        .update({ trial_last_beat_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('user_id', user.id)
    }
    // mode 'paid' deja en cours avec fenetre active : rien a faire, la fenetre tourne deja.

    return NextResponse.json({
      configured: true,
      mode,
      secondsRemaining,
      windowExpiresAt,
    })
  } catch (err: any) {
    console.error('[live/session] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
