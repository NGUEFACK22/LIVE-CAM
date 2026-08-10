'use client'

import { Analytics } from '@vercel/analytics/next'
import { useEffect, useState } from 'react'

// En mode desktop (Electron), le serveur Next tourne en localhost sans la
// plateforme Vercel : le script /_vercel/insights/script.js renvoie du
// text/html et est refuse par le navigateur (strict MIME). Ce refus peut
// bloquer l'hydratation des pages -> ecran vide. On desactive donc l'analytics
// Vercel uniquement dans le client de bureau.
export function AnalyticsProvider() {
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    setIsElectron(!!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron)
  }, [])

  if (isElectron) return null
  return <Analytics />
}
