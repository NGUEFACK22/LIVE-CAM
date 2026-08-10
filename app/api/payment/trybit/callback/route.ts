import { NextRequest, NextResponse } from 'next/server'
import { fulfillTrybitInvoice, verifyTrybitToken } from '@/lib/trybit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Parse le postback Trybit (JSON OU application/x-www-form-urlencoded).
async function parsePostback(request: NextRequest): Promise<Record<string, any>> {
  const contentType = request.headers.get('content-type') || ''
  try {
    if (contentType.includes('application/json')) {
      return await request.json()
    }
    const form = await request.formData()
    const obj: Record<string, any> = {}
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') obj[key] = value
    }
    return obj
  } catch (e) {
    console.error('[Trybit Callback] Parse echec:', e)
    return {}
  }
}

// POSTBACK Trybit : notification automatique apres confirmation d'une facture.
// L'URL est configuree dans le tableau de bord Trybit (Integration & API).
// Securite : on verifie le JWT HS256, PUIS on reconfirme la facture aupres de
// l'API Trybit (server-to-server) avant tout credit.
export async function POST(request: NextRequest) {
  const body = await parsePostback(request)

  const invoiceId: string | null =
    body?.invoice_id || body?.invoice_info?.uuid || null
  const token: string | null = body?.token ?? null

  if (!invoiceId) {
    console.error("[Trybit Callback] invoice_id introuvable dans le postback")
    return NextResponse.json({ success: false, error: 'invoice_id manquant' }, { status: 400 })
  }

  // Verification de signature. Le JWT HS256 du postback est une premiere
  // barriere ; la verification AUTORITAIRE reste la reconfirmation server-to-
  // server de la facture (fulfillTrybitInvoice -> getTrybitInvoiceInfo).
  //
  // - Si un token est fourni, il DOIT etre valide.
  // - S'il est absent et que TRYBIT_REQUIRE_SIGNATURE=true est defini (mode
  //   strict), on refuse le postback (aucune confiance au corps non signe).
  // - Sinon (defaut), on accepte mais on log un avertissement : le credit ne
  //   sera accorde qu'apres reconfirmation aupres de l'API Trybit.
  const requireSignature = process.env.TRYBIT_REQUIRE_SIGNATURE === 'true'

  if (token) {
    if (!verifyTrybitToken(token)) {
      console.error('[Trybit Callback] JWT invalide')
      return NextResponse.json({ success: false, error: 'signature invalide' }, { status: 401 })
    }
  } else if (requireSignature) {
    console.error('[Trybit Callback] Token manquant et TRYBIT_REQUIRE_SIGNATURE=true -> refus')
    return NextResponse.json({ success: false, error: 'signature manquante' }, { status: 401 })
  } else if (process.env.TRYBIT_SECRET) {
    console.warn(
      '[Trybit Callback] Token absent du postback — on s\'appuie sur la reconfirmation API Trybit. ' +
        'Mettez TRYBIT_REQUIRE_SIGNATURE=true pour exiger la signature.',
    )
  }

  const outcome = await fulfillTrybitInvoice({ uuid: String(invoiceId), source: 'trybit_callback' })
  console.log(
    `[Trybit Callback] invoice=${invoiceId} status=${outcome.status} alreadyDone=${outcome.alreadyDone}` +
      (outcome.result ? ` kind=${outcome.result.kind} linked=${outcome.result.userLinked}` : ''),
  )

  return NextResponse.json({ success: outcome.status === 'completed', status: outcome.status })
}
