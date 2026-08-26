'use client'

import { usePathname } from 'next/navigation'
import { isPathBlocked } from '@/lib/feature-flags'
import { BlockedFeatureCard } from '@/components/blocked-feature-modal'

export function BlockedGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  
  if (isPathBlocked(pathname)) {
    return <BlockedFeatureCard />
  }
  
  return <>{children}</>
}
