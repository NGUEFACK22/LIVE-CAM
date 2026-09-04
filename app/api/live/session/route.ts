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

    // Fallback : si l'utilisateur n'a ni fenetre active ni credits sessions
    // mais possede des points (ancien mode facturation a la seconde), il peut
    // quand meme demarrer : les points seront debites progressivement par
    // POST /api/points pendant la session.
    let pointsBalance = 0
    if (!state.canStart) {
      const { data: sub } = await admin
        .from('subscriptions')
        .select('points')
        .eq('user_id', user.id)
        .maybeSingle()
      pointsBalance = sub?.points ?? 0
    }

    if (!state.canStart && pointsBalance <= 0) {
      return NextResponse.json(
        {
          error:
            "Vous n'avez plus de crédits Live Swap. Achetez des crédits pour continuer.",
          mode: 'none',
          pendingWindows: state.pendingWindows,
          points: pointsBalance,
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
    let consumed = false

    // Fallback credits : ni fenetre ni credits, mais des points -> mode points.
    if (mode === 'none' && pointsBalance > 0) {
      mode = 'paid'
      secondsRemaining = pointsBalance
    }

    // Consommer un crédit UNIQUEMENT au lancement d'une nouvelle session
    // (mode 'ready' : credits disponibles mais aucune fenetre active).
    // Si une fenetre est DEJA active (mode 'paid'), on ne re-debite pas :
    // le temps restant continue de tourner.
    if (state.mode === 'ready' && row.pending_windows > 0) {
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
      consumed = true
      mode = 'paid'
      secondsRemaining = minutes * 60
      windowExpiresAt = expires.toISOString()

      // Créditer automatiquement les points de la fenêtre (1 pt/s) dans
      // subscriptions : la fenetre de 15 min = 15 * 60 = 900 points, qui
      // seront debites a la seconde pendant la session (meme logique que
      // POST /api/points). L'utilisateur peut donc swaper jusqu'a la fin de
      // sa fenetre sans etre bloque par un solde de points separé.
      const windowPoints = minutes * 60
      const { data: sub } = await admin
        .from('subscriptions')
        .select('points, max_points')
        .eq('user_id', user.id)
        .maybeSingle()
      if (sub) {
        const newPoints = (sub.points || 0) + windowPoints
        await admin
          .from('subscriptions')
          .update({
            points: newPoints,
            max_points: Math.max(sub.max_points || 0, newPoints),
          })
          .eq('user_id', user.id)
      }
    } else if (state.mode === 'trial') {
      // Marquer le debut du decompte d'essai
      await admin
        .from('live_access')
        .update({ trial_last_beat_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('user_id', user.id)
    }
    // mode 'paid' deja en cours avec fenetre active : rien a faire, la fenetre tourne deja.

    // Credits restants apres deduction eventuelle d'une fenetre.
    const windowsRemaining = consumed ? row.pending_windows - 1 : row.pending_windows

    return NextResponse.json({
      configured: true,
      mode,
      secondsRemaining,
      windowExpiresAt,
      pendingWindows: Math.max(0, windowsRemaining),
    })
  } catch (err: any) {
    console.error('[live/session] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
