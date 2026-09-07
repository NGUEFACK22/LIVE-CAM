'use client'

import { useEffect, useState } from 'react'
import { useNumbers } from '@/components/numbers/numbers-provider'
import { FUNDING_METHODS } from '@/lib/numbers/data'
import { formatPoints, pointsToXof, xofToPoints } from '@/lib/numbers/points'
import { Wallet, ArrowDownLeft, ArrowUpRight, Smartphone, CreditCard, Coins, Plus } from 'lucide-react'

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl'

const kindIcon: Record<string, typeof Smartphone> = {
  'Mobile Money': Smartphone,
  Card: CreditCard,
  Crypto: Coins,
}

const QUICK = [1000, 2500, 5000, 10000]

const TX_KIND_FR: Record<string, string> = {
  deposit: 'Dépôt',
  purchase: 'Achat',
  refund: 'Remboursement',
}

const KIND_LABEL: Record<string, string> = {
  'Mobile Money': 'Mobile Money',
  Card: 'Carte',
  Crypto: 'Crypto',
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function WalletPage() {
  const { balanceXof, balancePoints, transactions, refreshState } = useNumbers()

  const deposits = transactions.filter((t) => t.kind === 'deposit').reduce((s, t) => s + t.amountXof, 0)
  const spend = transactions.filter((t) => t.kind === 'purchase').reduce((s, t) => s + Math.abs(t.amountXof), 0)

  // Remi : ancien useEffect ?topup=success enlevé — la page redirige vers /recharge

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Portefeuille</h1>
          <p className="text-sm text-white/50">
            Des crédits partagés avec vos sessions vidéo — <span className="text-white/30">1 point = 20 FCFA</span>
          </p>
        </div>
        <div>
          <button
            onClick={() => window.location.href = '/recharge'}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" /> Recharger
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-600/20 to-blue-500/5 p-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-300">
            <Wallet className="h-5 w-5" />
          </span>
          <p className="mt-4 text-3xl font-semibold text-white">{formatPoints(balancePoints)}</p>
          <p className="text-sm text-white/50">
            Solde disponible <span className="text-xs text-white/30">({pointsToXof(balancePoints).toLocaleString('fr-FR')} FCFA)</span>
          </p>
        </div>
        <div className={`${card} p-5`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <ArrowDownLeft className="h-5 w-5" />
          </span>
          <p className="mt-4 text-2xl font-semibold text-white">{formatPoints(xofToPoints(deposits))}</p>
          <p className="text-xs text-white/40">{deposits.toLocaleString('fr-FR')} FCFA</p>
          <p className="text-sm text-white/50">Total déposé</p>
        </div>
        <div className={`${card} p-5`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/70">
            <ArrowUpRight className="h-5 w-5" />
          </span>
          <p className="mt-4 text-2xl font-semibold text-white">{formatPoints(xofToPoints(spend))}</p>
          <p className="text-xs text-white/40">{spend.toLocaleString('fr-FR')} FCFA</p>
          <p className="text-sm text-white/50">Total dépensé</p>
        </div>
      </div>

      {/* Moyens de paiement */}
      <div className={`${card} p-5`}>
        <h2 className="mb-4 font-semibold text-white">Moyens de paiement acceptés</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FUNDING_METHODS.map((m) => {
            const Icon = kindIcon[m.kind] ?? Wallet
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: `hsl(${m.hue} 70% 50% / 0.15)`, color: `hsl(${m.hue} 80% 65%)` }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{m.name}</p>
                  <p className="text-xs text-white/40">{KIND_LABEL[m.kind] ?? m.kind}</p>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-white/40">
          Les recharges sont traitées en ligne et sécurisées (Mobile Money, carte bancaire).
          Votre solde est crédité automatiquement dès la confirmation du paiement.
        </p>
      </div>

      {/* Transactions */}
      <div className="overflow-hidden">
        <div className="border-b border-white/5 p-5">
          <h2 className="font-semibold text-white">Transactions</h2>
        </div>
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Wallet className="h-8 w-8 text-white/20" />
            <p className="mt-2 text-sm text-white/50">Aucune transaction pour le moment</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-white/5">
                {[...transactions]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((t) => {
                    const positive = t.kind !== 'purchase'
                    return (
                      <tr key={t.id} className="text-white/70">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                                positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-300'
                              }`}
                            >
                              {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                            </span>
                            <div>
                              <p className="text-white">{TX_KIND_FR[t.kind] ?? t.kind}</p>
                              <p className="text-xs text-white/40">{t.method}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <p className={`font-medium ${positive ? 'text-emerald-400' : 'text-white'}`}>
                            {positive ? '+' : '−'}
                            {formatPoints(xofToPoints(Math.abs(t.amountXof)))}
                          </p>
                          <p className="text-[10px] text-white/40">{Math.abs(t.amountXof).toLocaleString('fr-FR')} FCFA</p>
                          <p className="text-xs text-white/40">{fmtDate(t.createdAt)}</p>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}