'use client'

import {
  Shield,
  Coins,
  Receipt,
  Users,
  Wrench,
  KeyRound,
  Mail,
  Gauge,
  Settings,
  Megaphone,
  Cpu,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'

const SECTIONS = [
  {
    href: '/admin/payments',
    icon: Receipt,
    title: 'Paiements & Transactions',
    desc: 'Voir les paiements, transactions reussies/echouees, recrediter',
    color: 'text-[#00ff88]',
    bg: 'bg-[#00ff88]/10',
  },
  {
    href: '/admin/credits',
    icon: Coins,
    title: 'Credits manuels',
    desc: 'Modifier le solde de points de n\u2019importe quel utilisateur',
    color: 'text-[#00ff88]',
    bg: 'bg-[#00ff88]/10',
  },
  {
    href: '/admin/subscriptions',
    icon: Users,
    title: 'Abonnements',
    desc: 'Activer ou retirer un abonnement manuellement',
    color: 'text-sky-400',
    bg: 'bg-sky-400/10',
  },
  {
    href: '/admin/installations',
    icon: Wrench,
    title: 'Installations',
    desc: 'Demandes d\u2019installation des clients',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
  },
  {
    href: '/admin/licenses',
    icon: KeyRound,
    title: 'Licences PC',
    desc: 'Gestion des licences desktop LIVECAM',
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
  },
  {
    href: '/admin/campaign',
    icon: Megaphone,
    title: 'Campagnes email',
    desc: 'Envoyer des emails marketing aux clients',
    color: 'text-[#00d4ff]',
    bg: 'bg-[#00d4ff]/10',
  },
  {
    href: '/admin/email',
    icon: Mail,
    title: 'Email personnalise',
    desc: 'Composer et envoyer un email a un client',
    color: 'text-pink-400',
    bg: 'bg-pink-400/10',
  },
  {
    href: '/admin/stats',
    icon: Gauge,
    title: 'Statistiques',
    desc: 'Chiffres cles de la plateforme',
    color: 'text-[#00ff88]',
    bg: 'bg-[#00ff88]/10',
  },
  {
    href: '/admin/consumption',
    icon: Cpu,
    title: 'Consommation',
    desc: 'Suivi de la consommation des utilisateurs',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
  },
  {
    href: '/admin/gpu',
    icon: Shield,
    title: 'GPU Workers',
    desc: 'Etat des workers live GPU',
    color: 'text-teal-400',
    bg: 'bg-teal-400/10',
  },
  {
    href: '/admin/settings',
    icon: Settings,
    title: 'Parametres',
    desc: 'Configuration generale du panneau admin',
    color: 'text-gray-300',
    bg: 'bg-gray-300/10',
  },
]

export default function AdminHubPage() {
  return (
    <div className="min-h-screen bg-[#050505] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00ff88]/15">
            <Shield className="h-6 w-6 text-[#00ff88]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Administration</h1>
            <p className="text-sm text-gray-500">Panneau de gestion LIVECAM</p>
          </div>
        </div>

        {/* Grid des sections */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-[#111] p-5 transition-all hover:border-[#00ff88]/40 hover:bg-[#151515]"
            >
              <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${s.bg}`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">{s.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{s.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff88]" />
            </Link>
          ))}
        </div>

        {/* Aides */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#0d1f16] p-6 text-sm text-gray-400">
          <h3 className="mb-2 font-semibold text-white">Raccourcis rapides</h3>
          <ul className="space-y-1.5">
            <li>
              <b className="text-[#00ff88]">Paiements & Transactions</b> → voir qui a paye (email), quand, et si
              c&apos;est reussi ou echoue
            </li>
            <li>
              <b className="text-[#00ff88]">Credits manuels</b> → ajouter ou definir le solde de points d&apos;un
              utilisateur
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}