import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { FREE_UNLIMITED_POINTS, isFreeLiveSwap } from '@/lib/free-mode'

// 1 credit = 1 seconde de swap
const POINTS_PER_SECOND = 1

export async function POST(request: NextRequest) {
  try {
    // On authentifie l'utilisateur avec SA session (pour obtenir son user_id)...
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Non authentifie' }, { status: 401 })
    }

    // Mode gratuit : aucune deduction, solde illimite.
    if (isFreeLiveSwap()) {
      return NextResponse.json({
        success: true,
        previousPoints: FREE_UNLIMITED_POINTS,
        pointsDeducted: 0,
        currentPoints: FREE_UNLIMITED_POINTS,
        maxPoints: FREE_UNLIMITED_POINTS,
        depleted: false,
        freeMode: true,
      })
    }

    // sendBeacon envoie un Blob (JSON ou text/plain) : on lit le corps brut et
    // on tente JSON.parse, quel que soit le Content-Type.
    const raw = await request.text().catch(() => '')
    let body: Record<string, unknown> = {}
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        // Corps non JSON : on ignore (aucune deduction).
      }
    }
    const pointsToDeduct = Number(body.pointsToDeduct) || 0
    const sessionDuration = Number(body.sessionDuration) || 0

    // Bornage serveur : le client ne dicte JAMAIS le montant max.
    // - sessionDuration plafonnee a 24h (anti abus).
    // - points demandes plafonnes a la duree declaree (1 pt/s) + 10s de marge.
    //   Un client malveillant ne peut donc pas deduire plus que le temps ecoule.
    const MAX_SESSION_SECONDS = 24 * 60 * 60
    const clampedDuration = Math.min(sessionDuration, MAX_SESSION_SECONDS)
    const maxByDuration = Math.floor(clampedDuration * POINTS_PER_SECOND) + POINTS_PER_SECOND * 10
    const points = Math.max(0, Math.min(Math.floor(pointsToDeduct), maxByDuration))
    if (points <= 0) {
      return NextResponse.json({ success: false, error: 'Rien a deduire' }, { status: 400 })
    }

    // ...mais on ecrit avec le service_role (RLS verrouille les ecritures via la
    // cle publique). C'est sur : on reste STRICTEMENT scope au user_id verifie,
    // donc l'utilisateur ne peut pas manipuler son propre solde depuis le client.
    const admin = createAdminClient()

    // Recuperer les points actuels (scope au user authentifie)
    const { data: subscription, error: fetchError } = await admin
      .from('subscriptions')
      .select('id, points, max_points, plan')
      .eq('user_id', user.id)
      .single()

    if (fetchError || !subscription) {
      return NextResponse.json({ 
        success: false, 
        error: 'Aucun abonnement trouve',
        currentPoints: 0
      }, { status: 404 })
    }

    const currentPoints = subscription.points || 0

    // Si le solde est deja a zero, rien a deduire : le swap doit s'arreter.
    if (currentPoints <= 0) {
      return NextResponse.json({
        success: false,
        error: 'Points insuffisants',
        currentPoints: 0,
        depleted: true,
      }, { status: 400 })
    }

    // Deduire ce qui est demande, mais jamais plus que le solde disponible.
    // Ainsi le client consomme TOUS ses points jusqu'a epuisement, sans
    // gaspiller le dernier palier incomplet.
    const pointsDeducted = Math.min(points, currentPoints)
    const newPoints = currentPoints - pointsDeducted
    const depleted = newPoints <= 0

    // Mise a jour ATOMIQUE (compare-and-swap) : la condition .eq('points', ...)
    // garantit qu'aucune requete concurrente (double clic, 2 onglets) ne peut
    // deduire en double. Si le solde a change entre-temps, la ligne n'est pas
    // mise a jour et on repond 409 (le client rejouera au prochain tick).
    const { data: updated, error: updateError } = await admin
      .from('subscriptions')
      .update({ 
        points: newPoints,
        updated_at: new Date().toISOString()
      })
      .eq('id', subscription.id)
      .eq('points', currentPoints)
      .select('points')
      .maybeSingle()

    if (updateError || !updated) {
      console.warn('[Points] Conflit de deduction (solde change entre-temps).')
      return NextResponse.json({ 
        success: false, 
        error: 'Conflit de synchronisation, reessayez',
        code: 'POINTS_CONFLICT'
      }, { status: 409 })
    }

    // Enregistrer la session de swap
    await admin.from('swap_sessions').insert({
      user_id: user.id,
      duration_seconds: sessionDuration || Math.floor(pointsDeducted / POINTS_PER_SECOND),
      points_used: pointsDeducted,
    })

    return NextResponse.json({
      success: true,
      previousPoints: currentPoints,
      pointsDeducted,
      currentPoints: newPoints,
      maxPoints: subscription.max_points || 0,
      // Signale au client que le solde est epuise -> il doit couper le swap.
      depleted,
    })

  } catch (error) {
    console.error('[Points] Error:', error)
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

// GET: Recuperer les points actuels de l'utilisateur
export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Non authentifie' }, { status: 401 })
    }

    // Mode gratuit : solde illimite pour le Live Swap.
    if (isFreeLiveSwap()) {
      return NextResponse.json({
        success: true,
        points: FREE_UNLIMITED_POINTS,
        maxPoints: FREE_UNLIMITED_POINTS,
        plan: 'unlimited',
        isActive: true,
        freeMode: true,
      })
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('points, max_points, plan, expires_at, is_active')
      .eq('user_id', user.id)
      .single()

    if (error || !subscription) {
      return NextResponse.json({
        success: true,
        points: 0,
        maxPoints: 0,
        plan: 'free',
        isActive: false
      })
    }

    // Verifier si l'abonnement est expire
    const isExpired = subscription.expires_at && new Date(subscription.expires_at) < new Date()
    
    return NextResponse.json({
      success: true,
      points: subscription.points || 0,
      maxPoints: subscription.max_points || 0,
      plan: subscription.plan || 'free',
      isActive: subscription.is_active && !isExpired,
      expiresAt: subscription.expires_at
    })

  } catch (error) {
    console.error('[Points] Error:', error)
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
