import { NextResponse } from 'next/server'
import { geniuspayConfigured } from '@/lib/geniuspay'
import { resolveVsnApiKey } from '@/lib/numbers/vsn-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Health check public (sans secrets) : indique si les briques paiement/numeros sont operantes.
// Utile en prod pour diagnostiquer instantanement un "credit non recu" (cles manquantes, callback URL, etc.).
export async function GET() {
  const geniuspay = geniuspayConfigured()
  const vsn = await resolveVsnApiKey().catch(() => ({ key: '', source: 'none' as const }))
  const hasVsn = !!vsn.key
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'https://chapcam.com'

  const ok = geniuspay && hasVsn

  return NextResponse.json({
    ok,
    at: new Date().toISOString(),
    geniuspay: {
      configured: geniuspay,
      hasKey: !!process.env.GENIUSPAY_API_KEY,
      hasSecret: !!process.env.GENIUSPAY_API_SECRET,
    },
    vsn: {
      configured: hasVsn,
      source: vsn.source,
    },
    appUrl: origin,
    vercel: {
      url: process.env.VERCEL_URL || null,
      prodUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || null,
      env: process.env.VERCEL_ENV || null,
    },
  })
}
