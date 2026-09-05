import { NextResponse, type NextRequest } from 'next/server'
import { requireUserId, UnauthorizedError } from '@/lib/numbers/auth'
import { countryByCode } from '@/lib/numbers/catalog'
import { listAvailableServices } from '@/lib/numbers/providers'

export async function GET(req: NextRequest) {
  try {
    await requireUserId()
    const { searchParams } = new URL(req.url)
    const country = countryByCode(searchParams.get('country') ?? '')
    if (!country) {
      return NextResponse.json({ error: 'Pays inconnu' }, { status: 400 })
    }
    const slugs = await listAvailableServices(country)
    const fiveKey = process.env.FIVE_SIM_API_KEY ?? ''
    return NextResponse.json({
      slugs,
      configured: !!fiveKey,
      probe: { keyLen: fiveKey.length, nodeEnv: process.env.NODE_ENV ?? '' },
    })
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.log('[v0] services route error:', (e as Error)?.message)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}