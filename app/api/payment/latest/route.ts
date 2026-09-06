import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Filet de securite pour la page de recharge : si l'utilisateur atterrit sur
// /recharge SANS ?token= dans l'URL (GeniusPay n'a pas glisse la reference
// dans la redirection), on retrouve son paiement GeniusPay le plus recent
// encore pending pour lancer le polling du statut.
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
      .eq('status', 'pending')
      .not('paydunya_token', 'is', null)
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