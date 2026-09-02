'use client'

import { Suspense, useState } from 'react'
import {
  CreditCard,
  Droplet,
  Loader2,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'next/navigation'
import { usePaymentCheckout } from '@/components/payment/use-payment-checkout'
import { PaymentBadgePopup } from '@/components/payment-badge-popup'
import { geniusPayFeeFor, geniusPayTotalToCharge } from '@/lib/geniuspay-fees'

function PlansContent() {
  const searchParams = useSearchParams()
  const { startCheckout, pendingKey, error, modal } = usePaymentCheckout()
  const [customAmount, setCustomAmount] = useState(1000)

  void searchParams

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      {modal}
      <PaymentBadgePopup />
      <div className="mx-auto max-w-2xl">
        {/* Banniere paiement securise */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="relative overflow-hidden rounded-2xl border border-primary/50 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 p-6">
            <div className="relative z-10 text-center">
              <div className="mb-2 flex items-center justify-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="text-lg font-bold text-primary">PAIEMENT EN LIGNE SECURISE</span>
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 text-xl font-black text-foreground md:text-2xl">
                Payez par <span className="text-primary">Carte bancaire, Wave, Orange, MTN, Moov ou Djamo</span> via
                GeniusPay
              </h3>
              <p className="text-sm text-muted-foreground">
                Activation automatique de votre solde des que le paiement est confirme.
              </p>
            </div>
          </div>
        </motion.div>

        <div className="mb-8 text-center">
          <h1 className="mb-4 text-4xl font-bold text-foreground md:text-5xl text-balance">
            Recharger mes crédits
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            20 F = 1 point • 2 points = 1 seconde de transformation
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Recharge libre - minimum 1000F */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="rounded-3xl border-2 border-primary bg-card p-6 md:p-8 shadow-[0_0_40px_rgba(0,255,136,0.15)]">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-black">
                <Wallet className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-foreground">Recharger des crédits</h3>
                <p className="text-xs text-muted-foreground">Minimum 1000 F</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <input
                  type="number"
                  min={1000}
                  step={500}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(Math.max(1000, Number(e.target.value) || 1000))}
                  className="w-full rounded-xl border border-hairline bg-muted px-4 py-3 pr-16 text-lg font-bold text-foreground focus:border-primary focus:outline-none"
                  placeholder="1000"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                  FCFA
                </span>
              </div>
              <button
                onClick={() => startCheckout('custom', { amount: customAmount } as any)}
                disabled={!!pendingKey || customAmount < 1000}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-black hover:bg-primary/90 disabled:opacity-50"
              >
                {pendingKey === 'custom' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CreditCard className="h-5 w-5" />
                )}
                Recharger {customAmount.toLocaleString()} F
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {Math.floor(customAmount / 20)} points •{' '}
              {Math.floor(Math.floor(customAmount / 20) / 2 / 60)} min{' '}
              {Math.floor((Math.floor(customAmount / 20) / 2) % 60)} sec de Live Swap
            </p>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Total à payer :{' '}
              <span className="font-semibold text-foreground">
                {geniusPayTotalToCharge(customAmount).toLocaleString('fr-FR')} FCFA
              </span>{' '}
              (dont {geniusPayFeeFor(customAmount).toLocaleString('fr-FR')} FCFA de frais de paiement) —{' '}
              {customAmount.toLocaleString('fr-FR')} F crédités
            </p>
          </div>
        </motion.div>

        {/* Usage des credits */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-card p-6 text-sm text-muted-foreground">
          <div className="mb-3 flex items-center gap-2">
            <Droplet className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">Comment sont utilisés mes crédits ?</span>
          </div>
          <ul className="space-y-1.5">
            <li>• Chaque recharge ajoute des points à votre solde.</li>
            <li>• 2 points = 1 seconde de transformation du visage et corps entier.</li>
            <li>• Votre solde restant est visible dans le menu Latéral du dashboard.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function PlansPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <PlansContent />
    </Suspense>
  )
}
