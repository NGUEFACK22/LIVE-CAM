"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"

// Launch offer ends 7 days after this date. Update LAUNCH_START when you ship.
const LAUNCH_START = new Date("2026-06-06T00:00:00Z").getTime()
const OFFER_DURATION_MS = 7 * 24 * 60 * 60 * 1000

function getRemaining() {
  const end = LAUNCH_START + OFFER_DURATION_MS
  const diff = Math.max(0, end - Date.now())
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
  const minutes = Math.floor((diff / (1000 * 60)) % 60)
  const seconds = Math.floor((diff / 1000) % 60)
  return { days, hours, minutes, seconds, ended: diff === 0 }
}

export function PcCountdown() {
  // IMPORTANT : `getRemaining()` appelle Date.now() — l'initialiser dans
  // useState le ferait tourner cote serveur PUIS cote client avec des valeurs
  // differentes (secondes ecoulees) -> React #418 (hydration mismatch). On
  // demarre a null (identique SSR/client) et on calcule apres montage.
  const [time, setTime] = useState<ReturnType<typeof getRemaining> | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setTime(getRemaining()), 0)
    const id = setInterval(() => setTime(getRemaining()), 1000)
    return () => {
      clearTimeout(t)
      clearInterval(id)
    }
  }, [])

  // Aucun rendu temporel tant que le compte a rebours n'est pas monte cote
  // client : le rendu serveur et le premier rendu client affichent les memes
  // valeurs (0 partout), donc pas de mismatch d'hydration.
  const safe = time ?? {
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    ended: false,
  }

  const units = [
    { label: "Jours", value: safe.days },
    { label: "Heures", value: safe.hours },
    { label: "Min", value: safe.minutes },
    { label: "Sec", value: safe.seconds },
  ]

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2 text-[#fbbf24]">
        <Clock className="w-4 h-4" />
        <span className="text-sm font-semibold tracking-wide uppercase">
          {safe.ended ? "Offre de lancement terminee" : "Fin du prix de lancement dans"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {units.map((u) => (
          <div
            key={u.label}
            className="flex flex-col items-center justify-center rounded-2xl border border-[#f97316]/30 bg-[#111827] px-4 py-3 min-w-[64px]"
          >
            <span className="text-3xl font-black text-[#fbbf24] tabular-nums">
              {String(u.value).padStart(2, "0")}
            </span>
            <span className="text-xs text-gray-400 uppercase tracking-wider mt-1">
              {u.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
