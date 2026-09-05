'use client'

import { useState } from 'react'

// Certains slugs du catalogue (hérités de theSVG.org, désormais hors ligne)
// ne correspondent pas au nom simple-icons : on traduit explicitement.
const ICON_SLUGS: Record<string, string> = {
  gate: 'gate.io',
  bookingcom: 'booking.com',
  mailru: 'mail.ru',
}

function resolveSlug(logo: string): string {
  return ICON_SLUGS[logo] ?? logo
}

/**
 * Logo de marque d'un service (WhatsApp, Telegram, Apple...).
 * Source : cdn.simpleicons.org (milier d'icônes officielles, livrées dans la
 * couleur de la marque). Fond blanc arrondi pour rester lisible sur le thème
 * sombre, y compris pour les logos noirs (Apple, X).
 * Retombe sur les initiales si l'icône n'existe pas ou ne charge pas.
 */
export function ServiceLogo({
  logo,
  label,
  size = 40,
  className = '',
}: {
  logo: string
  label: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const dim = `${size}px`

  if (failed) {
    return (
      <span
        className={`flex items-center justify-center rounded-xl bg-blue-500/15 text-sm font-bold text-blue-300 ${className}`}
        style={{ width: dim, height: dim }}
        aria-hidden="true"
      >
        {label.slice(0, 2)}
      </span>
    )
  }

  return (
    <span
      className={`flex items-center justify-center overflow-hidden rounded-xl bg-white ${className}`}
      style={{ width: dim, height: dim }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://cdn.simpleicons.org/${encodeURIComponent(resolveSlug(logo))}`}
        alt={`Logo ${label}`}
        width={size - 12}
        height={size - 12}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: size - 12, height: size - 12, objectFit: 'contain' }}
      />
    </span>
  )
}