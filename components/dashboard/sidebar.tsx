'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Zap, Users, BarChart2, Settings, LogOut, Menu, Battery, Shield, Home, Languages, ImageIcon, Film, HelpCircle, AudioLines, ChevronRight, Lock, AlertTriangle } from 'lucide-react'
import { isPathBlocked } from '@/lib/feature-flags'
import { useBlockedModal } from '@/components/blocked-feature-modal'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '@/components/ui/sheet'
import { createClient } from '@/lib/supabase/client'
import { isAdminEmail } from '@/lib/admin-email'
import { ThemeToggleCompact } from '@/components/theme-toggle'
import { POINTS_UPDATE_EVENT, type PointsUpdateDetail } from '@/lib/points-events'
import { useState, useEffect } from 'react'

// Seuil d'alerte : quand le solde descend sous cette valeur (en secondes = credits),
// on affiche une bannière d'alerte dans la sidebar.
const LOW_CREDIT_THRESHOLD = 60 // 1 minute de swap restante

interface NavItem {
  href: string
  icon: React.ElementType
  label: string
  badge?: 'NEW' | 'PRO'
  color: string
}

const navItems: NavItem[] = [
  { href: '/dashboard', icon: Home, label: 'DASHBOARD', color: '#34d399' },
  { href: '/dashboard/voice-swap', icon: AudioLines, label: 'VOICE SWAP', badge: 'NEW', color: '#ef4444' },
  { href: '/dashboard/voice-translator', icon: Languages, label: 'VOICE TRADUCTEUR', badge: 'NEW', color: '#38bdf8' },
  { href: '/dashboard/photo-video', icon: ImageIcon, label: 'PHOTOS EN VIDEO', badge: 'NEW', color: '#f59e0b' },
  { href: '/dashboard/video-translation', icon: Film, label: 'TRADUCTION VIDEO', badge: 'NEW', color: '#8b5cf6' },
  { href: '/dashboard/avatars', icon: Users, label: 'MES AVATARS', color: '#22d3ee' },
  { href: '/dashboard/stats', icon: BarChart2, label: 'STATISTIQUES', color: '#4ade80' },
  { href: '/dashboard/settings', icon: Settings, label: 'PARAMETRES', color: '#94a3b8' },
]

// Formatage deterministe (identique serveur/client) pour eviter les erreurs
// d'hydratation liees a la locale du runtime (toLocaleString varie SSR vs navigateur).
function formatPoints(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') // espace fine insecable comme separateur de milliers
}

type FeaturedTone = 'green' | 'blue' | 'purple'

const FEATURED_TONES: Record<
  FeaturedTone,
  { bg: string; border: string; shadow: string; tile: string; badge: string; sub: string }
> = {
  green: {
    bg: 'bg-gradient-to-br from-primary to-emerald-400 text-black',
    border: 'border-primary/40',
    shadow: 'shadow-primary/30',
    tile: 'bg-black/15',
    badge: 'bg-black/20 text-black',
    sub: 'text-black/70',
  },
  blue: {
    bg: 'bg-gradient-to-br from-[#2563EB] to-[#3b82f6] text-white',
    border: 'border-[#3b82f6]/40',
    shadow: 'shadow-[#2563EB]/40',
    tile: 'bg-white/15',
    badge: 'bg-white/20 text-white',
    sub: 'text-white/75',
  },
  purple: {
    bg: 'bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-white',
    border: 'border-[#7c3aed]/40',
    shadow: 'shadow-[#7c3aed]/40',
    tile: 'bg-white/15',
    badge: 'bg-white/20 text-white',
    sub: 'text-white/75',
  },
}

function FeaturedLink({
  href,
  icon: Icon,
  title,
  subtitle,
  badge,
  tone,
  active,
}: {
  href: string
  icon: React.ElementType
  title: string
  subtitle: string
  badge: string
  tone: FeaturedTone
  active?: boolean
}) {
  const t = FEATURED_TONES[tone]
  return (
    <Link
      href={href}
      className={`group relative mb-2 flex items-center gap-3 overflow-hidden rounded-xl border ${t.border} ${t.bg} p-2.5 shadow-lg ${t.shadow} transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 ${active ? 'ring-2 ring-white/50' : ''}`}
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.tile}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold uppercase leading-tight tracking-tight">
            {title}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${t.badge}`}
          >
            {badge}
          </span>
        </span>
        <span className={`mt-0.5 block truncate text-[10px] font-medium normal-case ${t.sub}`}>
          {subtitle}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  )
}

interface SidebarContentProps {
  email: string | undefined
  plan: string
  avatarCount: number
  pointsRemaining: number
  pointsTotal: number
  effectivePoints: number
  onLogout: () => void
}

function SidebarContent({
  email,
  plan,
  avatarCount,
  pointsRemaining,
  pointsTotal,
  effectivePoints,
  onLogout,
}: SidebarContentProps) {
  const pathname = usePathname()
  const { show, Modal } = useBlockedModal()
  const isUnlimited = plan === 'unlimited'
  const pointsPercentage = isUnlimited
    ? 100
    : pointsTotal > 0
      ? (pointsRemaining / pointsTotal) * 100
      : 0

  // Lien secret Admin (visible uniquement par les admins)
  const isAdmin = isAdminEmail(email)

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-5 pb-4 pt-6">
        <Link href="/dashboard" className="group flex items-center gap-3">
          {/* Tuile de marque */}
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-emerald-400 shadow-lg shadow-primary/30 transition-transform duration-200 group-hover:scale-105">
            <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </span>
            <Zap className="h-6 w-6 text-black" strokeWidth={2.5} />
          </span>

          <span className="min-w-0">
            <span className="block text-2xl font-extrabold leading-none tracking-tight">
              <span className="text-foreground">LIVE</span>
              <span className="text-primary">CAM</span>
            </span>
            <span className="mt-1.5 flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-faint">
                Swap en temps réel
              </span>
            </span>
          </span>
        </Link>
      </div>

      {/* Separateur */}
      <div className="mx-5 mb-2 h-px bg-gradient-to-r from-transparent via-hairline to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-1">
        <Modal />
        {navItems.map((item) => {
          const isActivePath = pathname === item.href
          const blocked = isPathBlocked(item.href)
          return (
            <div key={item.href}>
              {/* Boutons vedette premium (Live Swap / ChapCam PC / ChapSim) */}
              {item.href === '/dashboard/voice-swap' && (
                <div className="mb-3 mt-1">
                  <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-text-faint">
                    Live
                  </p>
                  <FeaturedLink
                    href="/dashboard/live-swap"
                    icon={Zap}
                    title="Live Swap"
                    subtitle="Change de visage en temps réel"
                    badge="Live"
                    tone="blue"
                    active={pathname === '/dashboard/live-swap'}
                  />
                </div>
              )}
            <div
              onClick={blocked ? (e) => { e.preventDefault(); show() } : undefined}
              className={blocked ? 'cursor-pointer' : ''}
            >
            <Link
              href={item.href}
              onClick={blocked ? (e) => { e.preventDefault(); show() } : undefined}
              style={{ ['--nav-accent' as string]: item.color }}
              className={`group/nav mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-bold uppercase tracking-tight transition-all duration-200 ${
                blocked ? 'opacity-60' : ''
              } ${
                isActivePath
                  ? 'bg-[var(--nav-accent)]/10 text-foreground shadow-sm ring-1 ring-[var(--nav-accent)]/30'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-all duration-200 group-hover/nav:brightness-110 group-hover/nav:shadow-[0_4px_14px_-4px_var(--nav-accent)]"
                style={{ backgroundColor: 'var(--nav-accent)' }}
              >
                <item.icon className="h-[17px] w-[17px]" strokeWidth={2.5} />
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {blocked ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <>
                  {item.badge === 'NEW' && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                      NEW
                    </span>
                  )}
                  {item.badge === 'PRO' && (
                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                      PRO
                    </span>
                  )}
                </>
              )}
            </Link>
            </div>
            </div>
          )
        })}

        {/* Aide & Support - bloqué */}
        <div
          onClick={(e) => { e.preventDefault(); show() }}
          className="group/nav mb-1 flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-bold uppercase tracking-tight text-muted-foreground opacity-60 transition-all duration-200 hover:bg-muted hover:text-foreground"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ backgroundColor: '#38bdf8' }}
          >
            <HelpCircle className="h-[17px] w-[17px]" strokeWidth={2.5} />
          </span>
          <span className="flex-1 truncate">AIDE & SUPPORT</span>
          <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        </div>

        {/* Lien Secret Admin */}
        {isAdmin && (
          <Link
            href="/admin"
            className="group/nav mb-1 flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-bold uppercase tracking-tight text-primary transition-all duration-200 ring-1 ring-primary/30 bg-primary/10 hover:bg-primary/15"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Shield className="h-[17px] w-[17px]" strokeWidth={2.5} />
            </span>
            <span className="flex-1 truncate">ADMIN</span>
          </Link>
        )}
      </nav>

      {/* User Info */}
      <div className="border-t border-hairline p-4">
        <p className="mb-3 truncate text-xs text-muted-foreground">{email}</p>

        {/* Bannière d'alerte : solde de crédits bas */}
        {!isUnlimited && effectivePoints <= LOW_CREDIT_THRESHOLD && effectivePoints > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-300">Crédits bas !</p>
              <p className="mt-0.5 text-[10px] text-amber-200/70">
                Il te reste seulement {Math.floor(effectivePoints / 60)} min {effectivePoints % 60 > 0 ? `${effectivePoints % 60} s` : ''} de swap.
              </p>
              <Link
                href="/dashboard/stats"
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 underline hover:text-amber-200"
              >
                Recharger <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}

        {/* Bannière : aucun crédit */}
        {!isUnlimited && effectivePoints <= 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-red-300">Aucun crédit</p>
              <p className="mt-0.5 text-[10px] text-red-200/70">
                Tu ne peux plus utiliser le Live Swap.
              </p>
              <Link
                href="/dashboard/stats"
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-red-300 underline hover:text-red-200"
              >
                Recharger maintenant <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}

        <div className="mb-3 rounded-lg bg-muted p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Battery className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-foreground">
                {isUnlimited ? 'Accès Live' : 'Points restants'}
              </span>
            </div>
            <span className="text-sm font-bold text-foreground">
              {isUnlimited ? 'Illimité' : `${formatPoints(pointsRemaining)}/${formatPoints(pointsTotal)}`}
            </span>
          </div>
          <Progress value={pointsPercentage} className="h-2 bg-secondary" />
          <p className="mt-2 text-xs text-text-faint">
            {isUnlimited
              ? 'Live Swap gratuit sans forfait'
              : `= ${Math.floor(pointsRemaining / 60)} min de swap`}
          </p>
        </div>

        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Avatars utilises</span>
          <span>{avatarCount}/∞</span>
        </div>

        {/* Bascule clair / sombre */}
        <div className="mb-3">
          <ThemeToggleCompact />
        </div>

        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-red-400"
        >
          <LogOut className="h-4 w-4" />
          Deconnexion
        </button>
      </div>
    </div>
  )
}

// Le reste du fichier reste identique (DashboardSidebar + PlanGuardBanner)
interface DashboardSidebarProps {
  email: string | undefined
  plan: string
  avatarCount: number
  pointsRemaining?: number
  pointsTotal?: number
}

export function DashboardSidebar({
  email,
  plan,
  avatarCount,
  pointsRemaining = 0,
  pointsTotal = 0,
}: DashboardSidebarProps) {
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Solde de points temps reel pendant le Live Swap : la page Live emet
  // 'chapcam:points-update' a chaque seconde (decrement local 1 pt/s) et
  // apres chaque synchronisation serveur (solde reel en base). Les props
  // serveur restent la valeur initiale / de repli.
  const [livePoints, setLivePoints] = useState<number | null>(null)
  const [liveTotal, setLiveTotal] = useState<number | null>(null)

  useEffect(() => {
    const onPointsUpdate = (e: Event) => {
      const detail = (e as CustomEvent<PointsUpdateDetail>).detail
      if (!detail || typeof detail.points !== 'number') return
      setLivePoints(detail.points)
      if (typeof detail.total === 'number' && detail.total > 0) {
        setLiveTotal(detail.total)
      }
    }
    window.addEventListener(POINTS_UPDATE_EVENT, onPointsUpdate)
    return () => window.removeEventListener(POINTS_UPDATE_EVENT, onPointsUpdate)
  }, [])

  const effectivePoints = livePoints ?? pointsRemaining
  const effectiveTotal = liveTotal ?? pointsTotal

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <>
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[240px] border-r border-hairline bg-sidebar md:block">
        <SidebarContent
          email={email}
          plan={plan}
          avatarCount={avatarCount}
          pointsRemaining={effectivePoints}
          pointsTotal={effectiveTotal}
          effectivePoints={effectivePoints}
          onLogout={handleLogout}
        />
      </aside>

      <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-hairline bg-sidebar px-4 md:hidden">
        <h1 className="text-xl font-bold">
          <span className="text-foreground">LIVE</span>
          <span className="text-primary">CAM</span>
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
            <Battery className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-foreground">{effectivePoints}</span>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="p-2 text-foreground">
                <Menu className="h-6 w-6" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] border-hairline bg-sidebar p-0">
              <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
              <SidebarContent
                email={email}
                plan={plan}
                avatarCount={avatarCount}
                pointsRemaining={effectivePoints}
                pointsTotal={effectiveTotal}
                effectivePoints={effectivePoints}
                onLogout={() => {
                  setMobileOpen(false)
                  handleLogout()
                }}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>
    </>
  )
}
