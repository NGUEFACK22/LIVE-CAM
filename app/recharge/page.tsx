'use client'

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { formatPoints, xofToPoints } from '@/lib/numbers/points'
import { geniusPayTotalToCharge, geniusPayFeeFor } from '@/lib/geniuspay-fees'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

const PRESETS = [500, 1000, 2500, 5000, 10000]

export default function RechargePage() {
  const [balancePoints, setBalancePoints] = useState(0)
  const [amountXof, setAmountXof] = useState(PRESETS[1])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'checking' | 'success' | 'cancelled' | 'error' | 'pending'>(
    'idle'
  )
  const [token, setToken] = useState<string | null>(null)

  // --- Initialisation ---
  useEffect(() => {
    async function init() {
      // Retour du paiement : GeniusPay redirige vers /recharge?token=...
      const params = new URLSearchParams(window.location.search)
      const t = params.get('token')
      // Filet de securite : si GeniusPay a redirige sans ?token= (reference
      // absente de l'URL de retour), on retrouve le dernier paiement pending
      // de l'utilisateur pour poller quand meme.
      const fallback = t
        ? null
        : await fetch('/api/payment/latest', { cache: 'no-store' })
            .then((r) => r.json())
            .then((d) => d.token ?? null)
            .catch(() => null)
      const token = t || fallback
      if (token) {
        setToken(token)
        setStatus('checking')
      }
      const res = await fetch('/api/points', { cache: 'no-store' })
      if (!res.ok) {
        // Non authentifié → se connecter
        window.location.href = '/auth/login?redirect=/recharge'
        return
      }
      const data = await res.json()
      setBalancePoints(data.points ?? 0)
    }
    init()
  }, [])

  // --- Rafraichit le solde quand le paiement aboutit ---
  useEffect(() => {
    if (status !== 'success') return
    fetch('/api/points', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setBalancePoints(d.points ?? 0))
      .catch(() => {})
  }, [status])

  // --- Polling du statut du paiement ---
  // Les paiements Mobile Money peuvent rester "pending" plusieurs dizaines de
  // secondes cote GeniusPay une fois le client de retour. On sonde donc jusqu'a
  // un statut TERMINAL (completed / cancelled / error), avec une cadence
  // ADAPTATIVE : rapide (2 s) pendant la premiere minute (delai de retour
  // GeniusPay habituel), puis espacee (5 s) — cela reduit fortement le nombre
  // d'appels a GeniusPay (rate-limit) tout en gardant une fenetre ~4 min au
  // total. Le cron de reconciliation reste le filet de secours.
  useEffect(() => {
    if (status !== 'checking') return
    if (!token) return
    const FAST_MS = 2000
    const SLOW_MS = 5000
    const fastAttempts = 20 // ~40 s rapides
    const maxAttempts = 64 // ~40 s + ~220 s lentes = ~4 min
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      attempts++
      try {
        const res = await fetch(`/api/payment/status?token=${token}`, {
          cache: 'no-store',
        })
        const data = await res.json()
        if (data.status === 'completed') {
          clearTimeout(timer)
          setStatus('success')
          return
        }
        if (data.status === 'cancelled') {
          clearTimeout(timer)
          setStatus('cancelled')
          return
        }
        if (data.status === 'error') {
          // Erreur de confirmation cote serveur : on laisse le polling
          // continuer quelques tentatives (le paiement a pu etre "pending"
          // le temps de confirmer), mais on abandonne apres la fenetre.
          if (attempts >= maxAttempts) {
            clearTimeout(timer)
            setStatus('error')
          }
          schedule()
          return
        }
        // 'pending' (ou autre) : encore en attente, on continue.
        if (attempts >= maxAttempts) {
          clearTimeout(timer)
          setStatus('pending')
          return
        }
        schedule()
      } catch {
        // erreur réseau → continuer
        schedule()
      }
    }
    const schedule = () => {
      const delay = attempts <= fastAttempts ? FAST_MS : SLOW_MS
      timer = setTimeout(poll, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [token, status])

  // --- Action : lancer le paiement ---
  async function handlePay() {
    if (amountXof < 500) return
    setLoading(true)
    setStatus('checking')
    try {
      const res = await fetch('/api/recharge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountXof }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setStatus('error')
        setLoading(false)
        // Erreur affichée par le composant ci-dessous
        return
      }
      // La page de paiement hébergée ne s'affiche qu'après ce clic.
      if (data.invoice_url) {
        window.location.href = data.invoice_url
        return
      }
      // Aucun lien de paiement renvoyé : on ne peut pas payer.
      setStatus('error')
      setLoading(false)
    } catch {
      setStatus('error')
      setLoading(false)
    }
  }

  // --- Affichage du statut ---
  let content
  switch (status) {
    case 'checking':
    case 'pending': {
      content = (
        <div className="text-center py-12">
          <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
          <p className="mt-4 text-lg text-white/70">
            {status === 'pending'
              ? 'Paiement confirmé, crédit en cours de traitement...'
              : 'Vérification du paiement...'}
          </p>
          <p className="mt-2 text-sm text-white/50">
            Cela peut prendre quelques instants. Votre solde sera actualisé automatiquement.
          </p>
          <button
            onClick={() => setStatus('checking')}
            className="mt-6 rounded-lg bg-primary py-2 px-6 text-sm font-medium text-black transition-colors hover:bg-primary/90"
          >
            Réessayer la vérification
          </button>
        </div>
      )
      break
    }
    case 'success': {
      content = (
        <div className="text-center py-12">
          <CheckCircle className="h-12 w-12 mx-auto text-primary" />
          <p className="mt-4 text-2xl font-bold text-primary">
            Vos points ont été crédités !
          </p>
          <p className="mt-2 text-lg text-white/70">
            Votre solde partagé (vidéos + numéros) a été mis à jour.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-lg bg-primary py-2 px-6 text-sm font-medium text-black transition-colors hover:bg-primary/90"
          >
            Aller au tableau de bord
          </Link>
          <Link
            href="/numbers/app"
            className="mt-2 inline-block rounded-lg bg-white/10 py-2 px-6 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            Retour à l&apos;espace numbers
          </Link>
        </div>
      )
      break
    }
    case 'cancelled': {
      content = (
        <div className="text-center py-12">
          <XCircle className="h-12 w-12 mx-auto text-red-400" />
          <p className="mt-4 text-lg text-white/70">La transaction a &eacute;t&eacute; annul&eacute;</p>
          <p className="mt-2 text-white/60">Aucun montant n&apos;a &eacute;t&eacute; d&eacute;bite.</p>
          <Link
            href="/recharge"
            className="mt-4 inline-block rounded-lg bg-primary py-2 px-6 text-sm font-medium text-black transition-colors hover:bg-primary/90"
          >
            Réessayer
          </Link>
        </div>
      )
      break
    }
    case 'error': {
      content = (
        <div className="text-center py-12">
          <XCircle className="h-12 w-12 mx-auto text-red-400" />
          <p className="mt-4 text-lg text-white/70">Erreur lors du paiement</p>
          <p className="mt-2 text-white/60">Vérifiez votre connexion et réessayez.</p>
          <Link
            href="/recharge"
            className="mt-4 inline-block rounded-lg bg-primary py-2 px-6 text-sm font-medium text-black transition-colors hover:bg-primary/90"
          >
            Réessayer
          </Link>
        </div>
      )
      break
    }
    default: {
      // Affichage initial : montant + bouton payer
      const fee = geniusPayFeeFor(amountXof)
      const total = geniusPayTotalToCharge(amountXof)
      const points = Math.round(amountXof / 20)
      content = (
        <div className="p-8 bg-white/10 rounded-2xl border border-white/20 backdrop-blur-xl">
          <h1 className="text-2xl font-bold text-white mb-4">
            Rechargez vos crédits
          </h1>
          <p className="text-white/50 mb-8">
            1 point = 20 FCFA — crédité sur votre solde partagé (vidéos + numéros)
          </p>
          <div className="grid grid-cols-2 gap-4 mb-6">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmountXof(p)}
                className={`flex-1 rounded-lg border py-2 ${
                  amountXof === p ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-white/10 text-white/60 hover:text-white'
                } transition-colors`}
              >
                <span className="block text-lg font-semibold text-white">
                  {formatPoints(Math.round(p / 20))}
                </span>
                <span className="text-[10px] text-white/40">{p.toLocaleString('fr-FR')} FCFA</span>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm text-white/50 mb-2">
              Montant personnalisé
            </label>
            <div className="relative">
              <input
                type="number"
                min={500}
                step={500}
                value={amountXof}
                onChange={(e) => setAmountXof(Number(e.target.value))}
                className="w-full bg-transparent px-3 py-2 text-lg font-semibold text-white outline-none placeholder:text-white/40"
                defaultValue={amountXof}
              />
              <span className="absolute right-3 text-xs text-white/40">FCFA</span>
            </div>
            <p className="mt-1 text-right text-sm font-semibold text-white">
              {formatPoints(Math.round(amountXof / 20))}
            </p>
          </div>

          <p className="mt-4 text-xs text-white/50">
            Frais de paiement : {formatPoints(Math.round(fee / 20))}{' '}
            <span className="text-white/30">({fee.toLocaleString('fr-FR')} FCFA)</span>
          </p>
          <p className="mt-2 text-white/50">
            <span className="text-sm font-semibold text-white">
              {points} points seront crédités
            </span>{' '}
            <span className="text-xs text-white/40">({Math.round(points / 60)} min de swap + reste)</span>
          </p>

          <button
            onClick={handlePay}
            disabled={loading || amountXof < 500}
            className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Redirection vers la page de paiement...
              </>
            ) : (
              <span className="block text-lg font-semibold">
                Payer {formatPoints(Math.round(geniusPayTotalToCharge(amountXof) / 20))}
                <span className="block text-xs font-normal text-white/50">
                  {geniusPayTotalToCharge(amountXof).toLocaleString('fr-FR')} FCFA incl.
                </span>
              </span>
            )}
          </button>

          <p className="mt-3 text-xs text-white/50">
            Vous serez redirigé vers une page de paiement sécurisée (Mobile Money, carte bancaire). Votre solde sera crédité automatiquement à la confirmation.
          </p>
        </div>
      )
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white p-4">
      <div className="max-w-2xl mx-auto">
        {content}
      </div>
    </div>
  )
}