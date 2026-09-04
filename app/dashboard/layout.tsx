import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { ChapCam2Announcement } from '@/components/dashboard/chapcam-2-announcement'
import { BlockedGuard } from '@/components/dashboard/blocked-guard'
import { FREE_UNLIMITED_POINTS, isFreeLiveSwap } from '@/lib/free-mode'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Auth protection
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/auth/login')
  }

  // Fetch subscription data avec points
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, points, max_points')
    .eq('user_id', user.id)
    .single()

  // Fetch avatar count
  const { count: avatarCount } = await supabase
    .from('user_avatars')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const freeMode = isFreeLiveSwap()
  const plan = freeMode ? 'unlimited' : (subscription?.plan ?? 'free')
  const pointsRemaining = freeMode
    ? FREE_UNLIMITED_POINTS
    : (subscription?.points ?? 0)
  const pointsTotal = freeMode
    ? FREE_UNLIMITED_POINTS
    : (subscription?.max_points ?? 0)

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar
        email={user.email}
        plan={plan}
        avatarCount={avatarCount ?? 0}
        pointsRemaining={pointsRemaining}
        pointsTotal={pointsTotal}
      />

      {/* Main Content Area */}
      <main className="min-h-screen pt-14 md:ml-[240px] md:pt-0">
        <BlockedGuard>{children}</BlockedGuard>
      </main>

      {/* Popup d'annonce ChapCam 2.0 (affiche une fois apres connexion) */}
      <ChapCam2Announcement />
    </div>
  )
}
