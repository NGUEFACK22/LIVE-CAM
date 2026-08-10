import { NextRequest, NextResponse } from 'next/server'
import { trackGPUUsage } from './rate-limit'
import { createClient as createSupabaseServerClient } from './supabase/server'

// Secret for internal API calls (set in env)
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || ''

export interface AuthenticatedUser {
  id: string
  email: string
  name?: string
}

export interface SessionValidationResult {
  success: boolean
  user?: AuthenticatedUser
  error?: string
}

// Validate user session from request
export async function validateSession(): Promise<SessionValidationResult> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return { success: false, error: 'Non authentifie' }
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email || '',
        name: user.user_metadata?.name || user.user_metadata?.full_name
      }
    }
  } catch (error) {
    console.error('[API Security] Session validation error:', error)
    return { success: false, error: 'Erreur de validation' }
  }
}

// Require authentication helper for API routes
export async function requireAuth(): Promise<{ user: AuthenticatedUser } | NextResponse> {
  const result = await validateSession()

  if (!result.success || !result.user) {
    return NextResponse.json(
      { error: result.error || 'Authentification requise', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  return { user: result.user }
}

// Check if user has enough points
export async function checkUserPoints(userId: string, requiredPoints: number): Promise<{ success: boolean; currentPoints: number; error?: string }> {
  try {
    // Import local pour eviter les cycles si free-mode evolue.
    const { FREE_UNLIMITED_POINTS, isFreeLiveSwap } = await import('@/lib/free-mode')
    if (isFreeLiveSwap()) {
      return { success: true, currentPoints: FREE_UNLIMITED_POINTS }
    }

    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase
      .from('user_points')
      .select('points')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('[Points Check] Error:', error)
      return { success: false, currentPoints: 0, error: 'Erreur de verification des points' }
    }

    const currentPoints = data?.points || 0

    if (currentPoints < requiredPoints) {
      return {
        success: false,
        currentPoints,
        error: `Points insuffisants. Tu as ${currentPoints} points, il te faut ${requiredPoints} points.`
      }
    }

    return { success: true, currentPoints }
  } catch (error) {
    console.error('[Points Check] Exception:', error)
    return { success: false, currentPoints: 0, error: 'Erreur systeme' }
  }
}

// Deduct points from user account
export async function deductUserPoints(userId: string, points: number, reason: string): Promise<{ success: boolean; newBalance: number; error?: string }> {
  try {
    const { FREE_UNLIMITED_POINTS, isFreeLiveSwap } = await import('@/lib/free-mode')
    if (isFreeLiveSwap()) {
      return { success: true, newBalance: FREE_UNLIMITED_POINTS }
    }

    const supabase = await createSupabaseServerClient()

    // Get current balance
    const { data: currentData, error: fetchError } = await supabase
      .from('user_points')
      .select('points')
      .eq('user_id', userId)
      .single()

    if (fetchError || !currentData) {
      return { success: false, newBalance: 0, error: 'Compte points non trouve' }
    }

    const newBalance = currentData.points - points

    if (newBalance < 0) {
      return { success: false, newBalance: currentData.points, error: 'Points insuffisants' }
    }

    // Mise a jour atomique (compare-and-swap) : la condition .eq('points', ...)
    // empeche deux requetes simultanees de deduire en double (double clic, 2 onglets).
    const { data: updated, error: updateError } = await supabase
      .from('user_points')
      .update({ points: newBalance, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('points', currentData.points)
      .select('points')
      .maybeSingle()

    if (updateError || !updated) {
      console.error('[Points Deduct] Update error (conflit ou echec):', updateError)
      return { success: false, newBalance: currentData.points, error: 'Erreur de mise a jour' }
    }

    // Log the transaction
    try {
      await supabase
        .from('points_transactions')
        .insert({
          user_id: userId,
          amount: -points,
          reason,
          created_at: new Date().toISOString()
        })
    } catch (err) {
      console.error('[Points Log] Error:', err)
    }

    console.log(`[Points] User ${userId}: -${points} points (${reason}). New balance: ${newBalance}`)

    return { success: true, newBalance }
  } catch (error) {
    console.error('[Points Deduct] Exception:', error)
    return { success: false, newBalance: 0, error: 'Erreur systeme' }
  }
}

// Validate internal API call (for server-to-server communication)
export function validateInternalCall(request: NextRequest): boolean {
  if (!INTERNAL_API_SECRET) return false

  const authHeader = request.headers.get('x-internal-secret')
  return authHeader === INTERNAL_API_SECRET
}

// GPU abuse protection wrapper
export async function withGPUProtection(
  userId: string,
  durationSeconds: number,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const { allowed, totalUsed } = trackGPUUsage(userId, durationSeconds)

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'Limite quotidienne atteinte. Tu as utilise 2 heures de swap aujourd\'hui. Reessaie demain.',
        totalUsedSeconds: totalUsed
      },
      { status: 429 }
    )
  }

  return handler()
}

// CORS headers for API responses
export function corsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = [
    'https://chapcam.com',
    'https://www.chapcam.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ]

  const requestOrigin = origin || ''
  const isAllowed = allowedOrigins.includes(requestOrigin)

  return {
    'Access-Control-Allow-Origin': isAllowed ? requestOrigin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  }
}

// Secure response helper
export function secureResponse(data: unknown, status: number = 200): NextResponse {
  const response = NextResponse.json(data, { status })

  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Cache-Control', 'no-store')

  return response
}
