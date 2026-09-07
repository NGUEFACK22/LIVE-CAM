import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmAndFulfillGeniusPay } from '@/lib/fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verifie l'etat d'un paiement GeniusPay pour la page de retour.
// Sert aussi de filet de securite : si le retour GeniusPay n'est pas (encore)
// arrive, cette route reconfirme aupres de GeniusPay et credite de maniere
// idempotente.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ status: 'error', error: 'Non authentifie.' }, { status: 401 })
  }

  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ status: 'error', error: 'token manquant.' }, { status: 400 })
  }

  // Seul le proprietaire du paiement peut sonder son statut. Une demande sans
  // lien avec l'utilisateur courant n'est pas confirmee (anti-fuite d'infos
  // entre comptes et anti-abus sur un token tiers).
  const admin = createAdminClient()
  const { data: owned } = await admin
    .from('payment_requests')
    .select('id')
    .eq('paydunya_token', token)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!owned) {
    return NextResponse.json({ status: 'error', error: 'Paiement introuvable.' }, { status: 404 })
  }

  const outcome = await confirmAndFulfillGeniusPay(token)

  return NextResponse.json({
    status: outcome.status,
    alreadyDone: outcome.alreadyDone,
    kind: outcome.result?.kind ?? null,
    chargedAmount: outcome.chargedAmount ?? null,
    netAmount: outcome.netAmount ?? null,
    fee: outcome.fee ?? null,
  })
}
