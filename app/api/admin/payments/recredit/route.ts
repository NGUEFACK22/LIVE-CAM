import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { confirmAndFulfillGeniusPay } from '@/lib/fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Re-credit manuel d'un paiement GeniusPay depuis l'admin.
// Reconfirme le paiement aupres de GeniusPay puis credite de maniere idempotente
// (ne double jamais un credit deja effectue). Trace dans payment_logs (source=manual).
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Acces refuse.' }, { status: 403 })
  }

  let token: string | null = null
  try {
    const body = await request.json()
    token = body?.token ? String(body.token) : null
  } catch {
    /* corps invalide */
  }

  if (!token) {
    return NextResponse.json({ error: 'token manquant.' }, { status: 400 })
  }

  const outcome = await confirmAndFulfillGeniusPay(token, 'manual')

  return NextResponse.json({
    ok: outcome.status === 'completed',
    status: outcome.status,
    alreadyDone: outcome.alreadyDone,
    kind: outcome.result?.kind ?? null,
    message: outcome.result?.message ?? null,
  })
}
