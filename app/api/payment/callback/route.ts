import { NextRequest, NextResponse } from 'next/server'
import { confirmAndFulfillGeniusPay } from '@/lib/fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retour GeniusPay. Deux usages :
//  1) GET : Apres le paiement, GeniusPay redirige le navigateur du client vers
//     `success_url` / `error_url` (deposees au moment de la creation du
//     paiement). On ne fait JAMAIS confiance au statut de l'URL : on reconfirme
//     toujours aupres de l'API GeniusPay (source de verite) puis on renvoie le
//     client vers la page de succes.
//  2) POST : eventuelle notification webhook GeniusPay — meme traitement
//     (reconfirmation serveur avant tout credit).
export async function GET(request: NextRequest) {
  const id =
    request.nextUrl.searchParams.get('reference') ||
    request.nextUrl.searchParams.get('token') ||
    request.nextUrl.searchParams.get('id')
  const origin = request.nextUrl.origin

  if (!id) {
    return NextResponse.redirect(`${origin}/dashboard/payment-success`)
  }

  // Reconfirmation autoritaire (idempotente, lance le credit si paye).
  await confirmAndFulfillGeniusPay(id, 'status')

  return NextResponse.redirect(`${origin}/dashboard/payment-success?token=${encodeURIComponent(id)}`)
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