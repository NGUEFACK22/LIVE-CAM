import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Filet de securite pour la page de recharge : si l'utilisateur atterrit sur
// /recharge SANS ?token= dans l'URL (GeniusPay n'a pas glisse la reference
// dans la redirection), on retrouve son paiement GeniusPay le plus recent
// encore pending pour lancer le polling du statut.
// Limite aux paiements RECENTS (30 min) : un ancien paiement abandonne ne doit
// pas faire passer la page en mode "verification" (et afficher "annule") au
// lieu du formulaire quand l'utilisateur vient simplement recharger.
const RECENT_WINDOW_MS = 30 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ token: null }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('payment_requests')
      .select('paydunya_token, created_at, plan, amount')
      .eq('user_id', user.id)
      .eq('payment_method', 'geniuspay')
      .eq('plan', 'numbers_wallet')
      .eq('status', 'pending')
      .not('paydunya_token', 'is', null)
      .gte('created_at', new Date(Date.now() - RECENT_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[payment/latest] Lecture echouee:', error.message)
      return NextResponse.json({ token: null })
    }

    return NextResponse.json({
      token: data?.paydunya_token || null,
      plan: data?.plan ?? null,
      amount: data?.amount ?? null,
      createdAt: data?.created_at ?? null,
    })
  } catch (e) {
    console.error('[payment/latest] Erreur:', e)
    return NextResponse.json({ token: null })
  }
}