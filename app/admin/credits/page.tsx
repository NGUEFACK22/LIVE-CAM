'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Coins,
  RefreshCw,
  Search,
  Loader2,
  Wallet,
  Plus,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Minus,
  Users,
} from 'lucide-react'
import Link from 'next/link'

interface CreditRow {
  id: string
  email: string
  plan: string
  points: number
  maxPoints: number
  isActive: boolean
  expiresAt: string | null
}

function fmtExpiry(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminCreditsPage() {
  const [rows, setRows] = useState<CreditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // Formulaire de credit manuel
  const [targetEmail, setTargetEmail] = useState('')
  const [points, setPoints] = useState('')
  const [action, setAction] = useState<'add' | 'set'>('add')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/credits', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erreur de chargement.')
        return
      }
      setRows(data.rows || [])
    } catch {
      setError('Erreur de connexion.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.email?.toLowerCase().includes(q) || r.plan?.toLowerCase().includes(q),
    )
  }, [rows, search])

  const submitCredit = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = targetEmail.trim().toLowerCase()
    const amount = Number(points)
    if (!email) {
      setToast({ type: 'err', msg: "Entrez l'email de l'utilisateur." })
      return
    }
    if (!Number.isFinite(amount) || amount < 1) {
      setToast({ type: 'err', msg: 'Entrez un nombre de points valide (>= 1).' })
      return
    }
    setSubmitting(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, points: amount, action }),
      })
      const data = await res.json()
      if (res.ok) {
        setToast({ type: 'ok', msg: data.message || 'Solde mis a jour.' })
        setTargetEmail('')
        setPoints('')
        await load(true)
      } else {
        setToast({ type: 'err', msg: data.error || 'Erreur.' })
      }
    } catch {
      setToast({ type: 'err', msg: 'Erreur de connexion.' })
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-gray-700 bg-[#0a0a0a] px-4 py-3 text-white outline-none transition-colors focus:border-[#00ff88]'
  const labelClass = 'mb-1.5 block text-sm font-medium text-gray-300'

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00ff88]/15">
              <Coins className="h-6 w-6 text-[#00ff88]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Credits manuels</h1>
              <p className="text-sm text-gray-500">
                Modifier le solde de points de n&apos;importe quel utilisateur
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/payments"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111] px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-[#00ff88] hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Paiements
            </Link>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl bg-[#00ff88] px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#00dd77] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Formulaire de credit manuel */}
        <form
          onSubmit={submitCredit}
          className="mb-8 rounded-2xl border border-[#00ff88]/20 bg-[#0d1f16] p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#00ff88]" />
            <h2 className="text-lg font-bold text-white">Modifier le solde</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Email de l&apos;utilisateur</label>
              <input
                type="email"
                required
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                className={inputClass}
                placeholder="utilisateur@exemple.com"
              />
            </div>
            <div>
              <label className={labelClass}>Nombre de points</label>
              <input
                type="number"
                required
                min={1}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className={inputClass}
                placeholder="5000"
              />
            </div>
            <div>
              <label className={labelClass}>Action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as 'add' | 'set')}
                className={inputClass}
              >
                <option value="add">Ajouter au solde</option>
                <option value="set">Definir un solde exact</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-xs text-gray-400">
              <b className={action === 'add' ? 'text-[#00ff88]' : 'text-gray-400'}>Ajouter</b> : ajoute les
              points au solde actuel.<br />
              <b className={action === 'set' ? 'text-[#00ff88]' : 'text-gray-400'}>Definir</b> : remplace le
              solde par la valeur exacte (utilisez ceci pour corriger une erreur).
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#00ff88] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#00dd77] disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : action === 'set' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {action === 'set' ? 'Definir le solde' : 'Crediter'}
            </button>
          </div>
        </form>

        {/* Statistiques */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <div className="mb-2 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Utilisateurs</span>
            </div>
            <p className="text-2xl font-bold text-white">{rows.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#00ff88]" />
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Comptes actifs</span>
            </div>
            <p className="text-2xl font-bold text-[#00ff88]">{rows.filter((r) => r.isActive).length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <div className="mb-2 flex items-center gap-2">
              <Minus className="h-4 w-4 text-yellow-400" />
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Expires</span>
            </div>
            <p className="text-2xl font-bold text-yellow-400">{rows.filter((r) => !r.isActive).length}</p>
          </div>
        </div>

        {/* Recherche */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par email ou formule..."
            className="w-full rounded-xl border border-white/10 bg-[#111] py-3 pl-12 pr-4 text-white placeholder-gray-600 outline-none transition-colors focus:border-[#00ff88]"
          />
        </div>

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#00ff88]" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#111] py-16 text-center text-gray-500">
            {search ? 'Aucun utilisateur ne correspond a la recherche.' : 'Aucun utilisateur credite pour le moment.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((r) => {
              const pct = r.maxPoints > 0 ? Math.min(100, Math.round((r.points / r.maxPoints) * 100)) : 0
              const low = r.points <= 0
              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#111] p-5 transition-colors hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-white">{r.email}</span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          r.isActive
                            ? 'border-[#00ff88]/30 bg-[#00ff88]/15 text-[#00ff88]'
                            : 'border-yellow-500/30 bg-yellow-500/15 text-yellow-400'
                        }`}
                      >
                        {r.isActive ? 'Actif' : 'Expire'}
                      </span>
                      {r.plan && r.plan !== 'free' && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-gray-400">
                          {r.plan}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-500">Expire le {fmtExpiry(r.expiresAt)}</p>
                  </div>
                  <div className="sm:w-56">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Coins className="h-4 w-4 text-[#00ff88]" />
                        <span className="text-xs font-medium text-gray-400">Solde</span>
                      </div>
                      <span className={`text-sm font-bold ${low ? 'text-red-400' : 'text-white'}`}>
                        {r.points.toLocaleString()}/{r.maxPoints.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all ${low ? 'bg-red-400' : 'bg-[#00ff88]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'ok'
              ? 'border-[#00ff88]/40 bg-[#0a1f15] text-[#00ff88]'
              : 'border-red-500/40 bg-[#1f0a0a] text-red-400'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}