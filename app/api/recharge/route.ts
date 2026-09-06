import { NextRequest, NextResponse } from 'next/server'
import { createRechargePayment } from '@/lib/recharge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { amountXof } = await request.json()
    const result = await createRechargePayment(amountXof)
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Impossible de créer le paiement. Réessaie.' },
        { status: 500 }
      )
    }
    return NextResponse.json({
      success: true,
      token: result.token,
      invoice_url: result.invoiceUrl,
      amount: result.amount,
      charged_amount: result.chargedAmount,
      fee: result.fee,
    })
  } catch (error) {
    console.error('[Recharge] Erreur:', error)
    return NextResponse.json({ success: false, error: 'Erreur serveur.' }, { status: 500 })
  }
}