import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/admin-auth'
import { resolveUserIdByEmail, logPaymentEvent } from '@/lib/fulfillment'
import { sendSubscriptionApprovedEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export interface CreditRow {
  id: string
  email: string
  plan: string
  points: number
  maxPoints: number
  isActive: boolean
  expiresAt: string | null
}

// GET: Liste les abonnements (email, solde en points) pour la page de credit manuel.
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Acces refuse.' }, { status: 403 })
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('subscriptions')
      .select('id, email, plan, points, max_points, is_active, end_date, expires_at')
      .order('end_date', { ascending: false })

    if (error) {
      console.error('[admin/credits] Erreur lecture subscriptions:', error.message)
      return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
    }

    const now = Date.now()
    const rows: CreditRow[] = (data || []).map((s) => {
      const expiry = s.expires_at || s.end_date
      return {
        id: s.id,
        email: s.email || '',
        plan: s.plan || 'free',
        points: Number(s.points ?? 0),
        maxPoints: Number(s.max_points ?? s.points ?? 0),
        isActive: !!s.is_active && (!expiry || new Date(expiry).getTime() > now),
        expiresAt: expiry,
      }
    })

    return NextResponse.json({ rows })
  } catch (err: any) {
    console.error('[admin/credits] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}

// POST: Credite / definit le solde de points d'un utilisateur.
// action = 'add' (ajoute au solde actuel) | 'set' (fixe le solde exactement).
export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Acces refuse.' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const email = String(body.email || '').trim().toLowerCase()
    const points = Number(body.points)
    const action = body.action === 'set' ? 'set' : 'add'
    const reason = body.reason ? String(body.reason).slice(0, 120) : ''

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Email invalide.' }, { status: 400 })
    }

    if (!Number.isFinite(points) || points < 1) {
      return NextResponse.json({ error: 'Points invalide (doit etre >= 1).' }, { status: 400 })
    }

    const admin = createAdminClient()

    const userId = await resolveUserIdByEmail(admin, email)
    if (!userId) {
      return NextResponse.json(
        {
          error: `Aucun compte LIVECAM ne correspond a "${email}".`,
        },
        { status: 404 },
      )
    }

    const now = new Date()

    const { data: existing } = await admin
      .from('subscriptions')
      .select('id, email, plan, points, max_points, amount, end_date, expires_at, is_active')
      .eq('user_id', userId)
      .maybeSingle()

    const prevActive = existing && existing.is_active && (existing.end_date || existing.expires_at)
      ? new Date(existing.end_date || existing.expires_at) > now
      : false

    const prevPoints = prevActive ? Number(existing?.points ?? 0) : 0
    const prevMax = prevActive ? Number(existing?.max_points ?? existing?.points ?? 0) : 0

    const targetMax = action === 'set' ? points : Math.max(prevMax, prevPoints + points)
    const targetPoints = action === 'set' ? Math.min(points, targetMax) : prevPoints + points

    // On prolonge la duree de 30 jours par tranche de 1000 points a partir de
    // la fin en cours (comportement identique aux recharges automatiques).
    const validityMs = Math.ceil(targetPoints / 1000) * 30 * 24 * 60 * 60 * 1000
    const base = prevActive && (existing?.end_date || existing?.expires_at)
      ? new Date(existing.end_date || existing.expires_at)
      : now
    const end = new Date(base.getTime() + validityMs)

    const subPayload = {
      user_id: userId,
      email,
      plan: existing?.plan || 'manual',
      amount: existing?.amount || 0,
      status: 'active',
      points: targetPoints,
      max_points: targetMax,
      is_active: true,
      start_date: now.toISOString(),
      end_date: end.toISOString(),
      expires_at: end.toISOString(),
    }

    if (existing) {
      const { error } = await admin.from('subscriptions').update(subPayload).eq('id', existing.id)
      if (error) {
        console.error('[credits] Erreur update subscription:', error.message)
        return NextResponse.json({ error: 'Erreur lors du credit.' }, { status: 500 })
      }
    } else {
      const { error } = await admin.from('subscriptions').insert(subPayload)
      if (error) {
        console.error('[credits] Erreur insert subscription:', error.message)
        return NextResponse.json({ error: 'Erreur lors du credit.' }, { status: 500 })
      }
    }

    // Journalisation
    await logPaymentEvent(admin, {
      source: 'manual',
      email,
      amount: targetPoints,
      status: 'completed',
      credited: true,
      creditKind: action === 'set' ? 'manual_set' : 'manual_credit',
      failureReason: reason || null,
    })

    // Email de confirmation
    const planLabel = action === 'set' ? 'Solde defini' : 'Recharge de points'
    await sendSubscriptionApprovedEmail(
      email,
      email.split('@')[0],
      `${planLabel} : ${targetPoints.toLocaleString()} pts`,
      Number(existing?.amount ?? 0),
      targetPoints,
      fmtDate(now),
      fmtDate(end),
    ).catch((e) => console.error('[credits] Email echoue:', e))

    return NextResponse.json({
      success: true,
      action,
      newPointBalance: targetPoints,
      message: `Nouveau solde: ${targetPoints.toLocaleString()} points pour ${email}.`,
    })
  } catch (err: any) {
    console.error('[credits] Exception:', err?.message || err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}