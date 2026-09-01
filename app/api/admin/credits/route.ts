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

// GET: Liste les utilisateurs inscrits sur la plateforme (profiles) ainsi que
// leur abonnement/solde (subscriptions) pour la page de credit manuel.
// La lecture se fait via createAdminClient() (service_role) qui bypass RLS,
// ce qui permet de voir TOUS les utilisateurs, pas seulement les credites.
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Acces refuse.' }, { status: 403 })
  }

  try {
    const admin = createAdminClient()

    // 1) Tous les utilisateurs inscrits (profiles = miroir de auth.users)
    const profilesRes = await admin
      .from('profiles')
      .select('id, email, full_name, plan, points, max_points, is_active, created_at')
      .order('created_at', { ascending: false })

    if (profilesRes.error) {
      console.error('[admin/credits] Erreur lecture profiles:', profilesRes.error.message)
    }

    // 2) Les abonnements (solde de points) pour enrichir chaque utilisateur
    const subsRes = await admin
      .from('subscriptions')
      .select('user_id, email, plan, points, max_points, is_active, end_date, expires_at')

    if (subsRes.error) {
      console.error('[admin/credits] Erreur lecture subscriptions:', subsRes.error.message)
    }

    const now = Date.now()
    const subsByUser = new Map<string, any>()
    for (const s of subsRes.data || []) {
      subsByUser.set(s.user_id, s)
    }

    const rows: CreditRow[] = []

    // On démarre par tous les profils (utilisateurs inscrits)
    for (const p of profilesRes.data || []) {
      const sub = subsByUser.get(p.id)
      const expiry = sub?.expires_at || sub?.end_date
      rows.push({
        id: p.id,
        email: p.email || '',
        plan: sub?.plan || p.plan || 'free',
        points: Number(sub?.points ?? p?.points ?? 0),
        maxPoints: Number(sub?.max_points ?? sub?.points ?? p?.max_points ?? p?.points ?? 0),
        isActive:
          (sub ? !!sub.is_active : p.is_active !== false) &&
          (!expiry || new Date(expiry).getTime() > now),
        expiresAt: expiry ?? null,
      })
    }

    // On ajoute les utilisateurs avec un abonnement mais sans profil (rare)
    for (const s of subsRes.data || []) {
      if (s.user_id && !rows.some((r) => r.id === s.user_id)) {
        const expiry = s.expires_at || s.end_date
        rows.push({
          id: s.user_id,
          email: s.email || '',
          plan: s.plan || 'free',
          points: Number(s.points ?? 0),
          maxPoints: Number(s.max_points ?? s.points ?? 0),
          isActive: !!s.is_active && (!expiry || new Date(expiry).getTime() > now),
          expiresAt: expiry,
        })
      }
    }

    rows.sort((a, b) => (a.email || '').localeCompare(b.email || ''))

    return NextResponse.json({ rows, total: rows.length })
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
        return NextResponse.json(
          { error: `Erreur lors du credit. ${error.message}. Verifie que SUPABASE_SERVICE_ROLE_KEY est configuree sur Vercel.` },
          { status: 500 },
        )
      }
    } else {
      const { error } = await admin.from('subscriptions').insert(subPayload)
      if (error) {
        console.error('[credits] Erreur insert subscription:', error.message)
        return NextResponse.json(
          { error: `Erreur lors du credit. ${error.message}. Verifie que SUPABASE_SERVICE_ROLE_KEY est configuree sur Vercel.` },
          { status: 500 },
        )
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