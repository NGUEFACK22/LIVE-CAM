import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================================
// Liens de paiement Wave par forfait (app_config.wave_links).
// GET  = liste les liens (avec valeurs par defaut si jamais configure)
// POST = enregistre les URL Wave sans toucher au code
// ============================================================

const CONFIG_KEY = 'wave_links'

interface WaveLink {
  plan: string
  label: string
  amount: number
  wave_url: string
}

const DEFAULT_LINKS: WaveLink[] = [
  { plan: 'starter', label: 'Starter', amount: 10000, wave_url: '' },
  { plan: 'premium', label: 'Premium', amount: 50000, wave_url: '' },
  { plan: 'ultimate', label: 'VIP PRO', amount: 85000, wave_url: '' },
  { plan: 'vipdebout', label: 'VIP DEBOUT', amount: 150000, wave_url: '' },
]

async function readLinks(): Promise<WaveLink[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('app_config').select('value').eq('key', CONFIG_KEY).maybeSingle()
  if (error) throw new Error(`Lecture app_config.${CONFIG_KEY}: ${error.message}`)
  if (data?.value) {
    const parsed = JSON.parse(data.value)
    if (Array.isArray(parsed)) {
      return DEFAULT_LINKS.map((d) => {
        const saved = parsed.find((l: any) => l.plan === d.plan) as Partial<WaveLink> | undefined
        return { ...d, wave_url: typeof saved?.wave_url === 'string' ? saved.wave_url : '' }
      })
    }
  }
  return DEFAULT_LINKS
}

// GET - liste les liens Wave (admin)
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
  }
  try {
    const links = await readLinks()
    return NextResponse.json({ links })
  } catch (e: any) {
    console.error('[wave-links] GET error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST - enregistre les URL Wave
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const incoming: { plan: string; wave_url: string }[] = Array.isArray(body?.links) ? body.links : []

    const merged = DEFAULT_LINKS.map((d) => {
      const saved = incoming.find((l) => l.plan === d.plan)
      return { ...d, wave_url: typeof saved?.wave_url === 'string' ? saved.wave_url.trim() : d.wave_url }
    })

    const admin = createAdminClient()
    const { error } = await admin
      .from('app_config')
      .upsert({ key: CONFIG_KEY, value: JSON.stringify(merged), description: 'Liens de paiement Wave par forfait', updated_at: new Date().toISOString() })

    if (error) throw new Error(`Ecriture app_config.${CONFIG_KEY}: ${error.message}`)

    return NextResponse.json({ message: 'Liens Wave enregistres' })
  } catch (e: any) {
    console.error('[wave-links] POST error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}