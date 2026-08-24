import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { isAdminEmail } from '@/lib/admin-email'

// Proxy minimal de protection (Next 16 : anciennement middleware.ts) :
//  - redirige vers /auth/login les visiteurs non connectes sur /dashboard et /numbers/app ;
//  - protege /admin (pages) et /api/admin (routes) : utilisateur connecte + email admin.
//  - toutes les autres routes passent sans latence (matcher restreint).
// Les routes API font de toute facon leur propre verification (isAdminRequest,
// requireAuth) : ce proxy est une couche de defense supplementaire.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase non configure : on laisse passer, chaque route se protege elle-meme.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPrivatePage = pathname.startsWith('/dashboard') || pathname.startsWith('/numbers/app')

  // Pages privees : rediriger vers le login.
  if (isPrivatePage && !user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    loginUrl.searchParams.set('redirected', '1')
    return NextResponse.redirect(loginUrl)
  }

  // Pages admin : connecte ET email admin, sinon 403.
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/auth/login'
      return NextResponse.redirect(loginUrl)
    }
    if (!isAdminEmail(user.email)) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Routes API admin : blocage precoce des non authentifies / non admin.
  if (pathname.startsWith('/api/admin')) {
    if (!user) {
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
    }
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })
    }
  }

  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/api/admin/:path*',
    '/numbers/app/:path*',
  ],
}
