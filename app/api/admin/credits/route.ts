import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/admin-auth'
import { logPaymentEvent } from '@/lib/fulfillment'
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
    const now = new Date()

    // On passe par la fonction SQL admin_set_credit (SECURITY DEFINER) qui
    // contourne RLS et permet de crediter N'IMPORTE quel utilisateur, meme
    // sans cle service_role (fallback anon). Elle resout le user, met a jour
    // la subscription + le profil, et prolonge la duree.
    const { data: rpcData, error: rpcError } = await admin.rpc('admin_set_credit', {
      p_email: email,
      p_points: points,
      p_action: action,
    })

    if (rpcError) {
      console.error('[credits] Erreur RPC admin_set_credit:', rpcError.message, rpcError.details)
      const msg = String(rpcError.message || '')
      if (/aucun compte/i.test(msg)) {
        return NextResponse.json(
          { error: `Aucun compte LIVECAM ne correspond a "${email}".` },
          { status: 404 },
        )
      }
      return NextResponse.json(
        { error: msg || 'Erreur lors du credit.' },
        { status: 500 },
      )
    }

    const targetPoints = Number(rpcData?.points ?? points)
    const end = rpcData?.end_date ? new Date(rpcData.end_date) : now

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
      0,
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