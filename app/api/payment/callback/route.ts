import { NextRequest, NextResponse } from 'next/server'
import { confirmAndFulfillGeniusPay } from '@/lib/fulfillment'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retrouve la reference du paiement GENIUS le plus recent encore pending pour
// un utilisateur donne (filet de securite si GeniusPay redirige vers
// success_url SANS reference dans l'URL ; voir GET ci-dessous).
// Limite aux 30 dernieres minutes : un ancien paiement abandonne ne doit pas
// etre confondu avec un paiement venant d'etre effectue.
const RECENT_WINDOW_MS = 30 * 60 * 1000

async function findLatestPendingToken(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('payment_requests')
      .select('paydunya_token, created_at')
      .eq('user_id', userId)
      .eq('payment_method', 'geniuspay')
      .eq('status', 'pending')
      .not('paydunya_token', 'is', null)
      .gte('created_at', new Date(Date.now() - RECENT_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.paydunya_token || null
  } catch (e) {
    console.error('[callback] Lecture dernier pending echouee:', e)
    return null
  }
}

// Retour GeniusPay. Deux usages :
//  1) GET : Apres le paiement, GeniusPay redirige le navigateur du client vers
//     `success_url` / `error_url` (deposees au moment de la creation du
//     paiement). On ne fait JAMAIS confiance au statut de l'URL : on reconfirme
//     toujours aupres de l'API GeniusPay (source de verite) puis on renvoie le
//     client vers la page de succes.
//  2) POST : eventuelle notification webhook GeniusPay — meme traitement
//     (reconfirmation serveur avant tout credit).
export async function GET(request: NextRequest) {
  let id =
    request.nextUrl.searchParams.get('reference') ||
    request.nextUrl.searchParams.get('token') ||
    request.nextUrl.searchParams.get('id')
  const origin = request.nextUrl.origin

  if (!id) {
    // GeniusPay ne glisse pas toujours la reference dans la redirection de
    // retour. Si l'utilisateur est connecte (meme navigateur, cookies deja
    // presents), on retombe sur son paiement GeniusPay le plus recent encore
    // pending pour crediter automatiquement quand meme.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(`${origin}/dashboard/payment-success`)
    }
    const fallback = await findLatestPendingToken(user.id)
    if (!fallback) {
      return NextResponse.redirect(`${origin}/dashboard/payment-success`)
    }
    id = fallback
  }

  // Reconfirmation autoritaire (idempotente, lance le credit si paye).
  await confirmAndFulfillGeniusPay(id, 'status')

  // Redirection vers la page de retour specifiee (ex: /recharge) ou fallback
  // vers la page de succes du tableau de bord.
  const returnTo = request.nextUrl.searchParams.get('return_to')
  const safeReturnTo =
    returnTo && returnTo.startsWith('/')
      ? returnTo
      : undefined
  const redirectUrl =
    safeReturnTo ? `${origin}${safeReturnTo}` : `${origin}/dashboard/payment-success`

  return NextResponse.redirect(`${redirectUrl}?token=${encodeURIComponent(id)}`)
}

export async function POST(request: NextRequest) {
  let id: string | null = null
  let body: any = null
  try {
    body = await request.json()
  } catch {
    /* corps vide ou non-JSON */
  }
  // Webhook GeniusPay : l'identifiant se trouve selon le format de l'evenement
  // (reference ou transaction id).
  id =
    String(
      body?.data?.reference ||
        body?.reference ||
        body?.transaction?.reference ||
        body?.data?.id ||
        body?.data?.object?.id ||
        body?.id ||
        '',
    ) || null

  if (!id) {
    return NextResponse.json({ success: false, error: 'id manquant' })
  }

  const outcome = await confirmAndFulfillGeniusPay(id, 'status')

  return NextResponse.json({
    success: outcome.status === 'completed',
    status: outcome.status,
    alreadyDone: outcome.alreadyDone,
  })
}