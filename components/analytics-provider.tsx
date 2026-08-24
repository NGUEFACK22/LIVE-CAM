'use client'

import { Analytics } from '@vercel/analytics/next'
import { useState } from 'react'

// En mode desktop (Electron), le serveur Next tourne en localhost sans la
// plateforme Vercel : le script /_vercel/insights/script.js renvoie du
// text/html et est refuse par le navigateur (strict MIME). Ce refus peut
// bloquer l'hydratation des pages -> ecran vide. On desactive donc l'analytics
// Vercel uniquement dans le client de bureau.
//
// IMPORTANT : la detection DOIT etre synchrone (initialiseur de useState),
// pas un effet differe. Le preload expose `window.electronAPI` AVANT le
// premier rendu, donc on la connait des le montage. Avec un setTimeout(0),
// le useEffect du composant enfant <Analytics> (qui injecte le <script>
// dans le <head>) s'executait AVANT notre bascule -> le script etait charge
// quand meme, MIME refuse, hydratation cassee. Le rendu serveur rend
// <Analytics /> (qui retourne null, aucune injection SSR), et le premier
// rendu client rend aussi null quand isElectron=true : pas de mismatch
// d'hydration.
export function AnalyticsProvider() {
  const [isElectron] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron
  })

  if (isElectron) return null
  return <Analytics />
}
