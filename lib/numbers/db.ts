import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { pointsToXof, xofToPoints } from './points'

// ============================================================
// Stockage de la plateforme Numéros virtuels : Supabase (même base que les
// points vidéo). Le solde UNIQUE = subscriptions.points (1 point = 20 FCFA) :
//   - les vidéos (Live Swap) consomment des points (1 pt/s),
//   - les achats de numéros convertissent le prix FCFA en points.
// Les tables numbers_activations / numbers_wallet_tx sont créées par
// supabase/numbers-unified.sql (RLS : lecture propriétaire, écriture
// service_role). Plus aucun DATABASE_URL / Neon requis.
// ============================================================

export type WalletRow = { user_id: string; balance_xof: number; updated_at: string }
export type TxRow = {
  id: number
  user_id: string
  kind: 'deposit' | 'purchase' | 'refund'
  amount_xof: number
  method: string
  reference: string | null
  status: string
  created_at: string
}
export type ActivationRow = {
  id: number
  user_id: string
  provider: string
  provider_order: string
  country_code: string
  service_slug: string
  service_label: string
  phone_e164: string
  price_xof: number
  cost_usd: string
  status: 'waiting' | 'received' | 'cancelled' | 'expired'
  code: string | null
  full_sms: string | null
  created_at: string
  expires_at: string | null
  updated_at: string
}

function client() {
  return createAdminClient()
}

/** Lit le solde en points de l'utilisateur (0 si aucun abonnement). */
async function readPoints(userId: string): Promise<number> {
  const { data, error } = await client()
    .from('subscriptions')
    .select('points')
    .eq('user_id', userId)
    .maybeSingle()
  // PGRST116 = aucune ligne : solde 0 (jamais rechargé).
  if (error && error.code !== 'PGRST116') throw new Error('solde inaccessible')
  return Number((data as { points?: number | null } | null)?.points ?? 0)
}

/**
 * Applique un mouvement (positif = crédit, négatif = débit) au solde de points
 * de façon ATOMIQUE via la RPC `numbers_adjust_points` (une seule instruction
 * UPDATE transactionnelle, refus de tout solde négatif, création de la ligne
 * abonnement au premier crédit). Aucune course possible entre un achat de
 * numéro et une vidéo en cours, et jamais de solde négatif persisté.
 */
async function applyPointsDelta(userId: string, deltaPoints: number): Promise<number> {
  const { data, error } = await client().rpc('numbers_adjust_points', {
    p_user_id: userId,
    p_delta: deltaPoints,
  })
  if (error) {
    const msg = error.message ?? ''
    if (/POINTS_INSUFFICIENT|insufficient/i.test(msg)) throw new Error('POINTS_INSUFFICIENT')
    throw new Error('solde inaccessible')
  }
  return Number(data ?? 0)
}

async function insertTx(
  userId: string,
  deltaXof: number,
  tx: { kind: TxRow['kind']; method?: string; reference?: string; status?: string },
) {
  await client().from('numbers_wallet_tx').insert({
    user_id: userId,
    kind: tx.kind,
    amount_xof: Math.round(deltaXof),
    method: tx.method ?? 'points',
    reference: tx.reference ?? null,
    status: tx.status ?? 'completed',
  })
}

/** Récupère (ou évalue) le solde unifié de l'utilisateur. Solde en XOF (points × 20). */
export async function getWallet(userId: string): Promise<WalletRow> {
  const points = await readPoints(userId)
  return {
    user_id: userId,
    balance_xof: pointsToXof(points),
    updated_at: new Date().toISOString(),
  }
}

export async function getBalance(userId: string): Promise<number> {
  const w = await getWallet(userId)
  return Number(w.balance_xof)
}

/** Crédite/débite le solde unifié (points) de façon atomique et journalise le mouvement. */
export async function adjustWallet(
  userId: string,
  deltaXof: number,
  tx: { kind: TxRow['kind']; method?: string; reference?: string; status?: string },
): Promise<number> {
  const newPoints = await applyPointsDelta(userId, xofToPoints(deltaXof))
  // Le journal est best-effort : si son écriture échoue, les points sont déjà
  // bougés et on ne DOIT PAS faire croire au client que son paiement a échoué
  // (risque de double débit au retry). On journalise l'erreur et on continue.
  try {
    await insertTx(userId, deltaXof, tx)
  } catch (e) {
    console.log('[v0] numbers_wallet_tx journal write failed:', (e as Error)?.message)
  }
  return pointsToXof(newPoints)
}

/**
 * Rembourse une activation UNE SEULE FOIS, de façon atomique et idempotente.
 * Empêche tout double remboursement lorsque plusieurs déclencheurs agissent sur
 * la même activation (polling front + cron de réconciliation, double clic…).
 * La RPC `numbers_refund_once` exécute le verrou (ligne 'refund', index unique
 * `provider:order`) ET le crédit des points dans la MÊME transaction : tout
 * échec annule tout, aucune perte ni double crédit.
 * Renvoie `true` si le remboursement a été effectué, `false` s'il existait déjà.
 */
export async function refundActivationOnce(
  userId: string,
  provider: string,
  order: string,
  amountXof: number,
): Promise<boolean> {
  const { data, error } = await client().rpc('numbers_refund_once', {
    p_user_id: userId,
    p_reference: `${provider}:${order}`,
    p_amount_xof: Math.round(amountXof),
  })
  if (error) throw new Error(`remboursement: ${error.message}`)
  return data === true
}

export async function listTransactions(userId: string, limit = 50): Promise<TxRow[]> {
  const { data, error } = await client()
    .from('numbers_wallet_tx')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as TxRow[]
}

export async function createActivation(a: {
  userId: string
  provider: string
  providerOrder: string
  countryCode: string
  serviceSlug: string
  serviceLabel: string
  phoneE164: string
  priceXof: number
  costUsd: number
  expiresAt: Date | null
}): Promise<ActivationRow> {
  const { data, error } = await client()
    .from('numbers_activations')
    .insert({
      user_id: a.userId,
      provider: a.provider,
      provider_order: a.providerOrder,
      country_code: a.countryCode,
      service_slug: a.serviceSlug,
      service_label: a.serviceLabel,
      phone_e164: a.phoneE164,
      price_xof: Math.round(a.priceXof),
      cost_usd: a.costUsd,
      expires_at: a.expiresAt ? a.expiresAt.toISOString() : null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as unknown as ActivationRow
}

export async function listActivations(userId: string, limit = 100): Promise<ActivationRow[]> {
  const { data, error } = await client()
    .from('numbers_activations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ActivationRow[]
}

/** Activations encore en attente de SMS — utilisé par la réconciliation (tous utilisateurs). */
export async function listWaitingActivations(limit = 200): Promise<ActivationRow[]> {
  const { data, error } = await client()
    .from('numbers_activations')
    .select('*')
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ActivationRow[]
}

export async function getActivation(userId: string, id: number): Promise<ActivationRow | null> {
  const { data, error } = await client()
    .from('numbers_activations')
    .select('*')
    .eq('user_id', userId)
    .eq('id', Number(id))
    .maybeSingle()
  if (error) return null
  return (data as unknown as ActivationRow | null) ?? null
}

export async function updateActivation(
  userId: string,
  id: number,
  patch: { status?: ActivationRow['status']; code?: string | null; fullSms?: string | null },
): Promise<ActivationRow | null> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status) updates.status = patch.status
  if (patch.code) updates.code = patch.code
  if (patch.fullSms) updates.full_sms = patch.fullSms
  const { data, error } = await client()
    .from('numbers_activations')
    .update(updates)
    .eq('user_id', userId)
    .eq('id', Number(id))
    .select('*')
    .maybeSingle()
  if (error) return null
  return (data as unknown as ActivationRow | null) ?? null
}

/**
 * Supprime définitivement une activation. Utilisé lorsqu'un numéro n'a reçu
 * AUCUN code SMS (expiration ou annulation) : le client est remboursé et le
 * numéro ne doit laisser aucune trace dans l'historique des activations.
 * Sûr : on ne supprime jamais une activation ayant reçu un code (garde-fou
 * `code IS NULL` en plus du cloisonnement par utilisateur).
 */
export async function deleteActivation(userId: string, id: number): Promise<boolean> {
  const { data, error } = await client()
    .from('numbers_activations')
    .delete()
    .eq('user_id', userId)
    .eq('id', Number(id))
    .is('code', null)
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

// ------------------------------------------------------------
// Requêtes ADMIN (non cloisonnées par utilisateur).
// À n'appeler QUE depuis un contexte vérifié admin (fanny.guck@gmail.com).
// ------------------------------------------------------------

export type AdminStats = {
  users: number
  totalBalanceXof: number
  depositsXof: number
  spendXof: number
  refundsXof: number
  activationsTotal: number
  activationsReceived: number
  activationsWaiting: number
}

const EMPTY_STATS: AdminStats = {
  users: 0,
  totalBalanceXof: 0,
  depositsXof: 0,
  spendXof: 0,
  refundsXof: 0,
  activationsTotal: 0,
  activationsReceived: 0,
  activationsWaiting: 0,
}

// Les requêtes admin sont défensives : en cas d'erreur DB (table absente,
// RPC non exécuté…), on renvoie des valeurs vides au lieu de jeter, pour que
// la page d'administration s'affiche toujours pour l'admin.
export async function adminStats(): Promise<AdminStats> {
  try {
    const { data } = await client().rpc('numbers_admin_stats')
    const d = (data ?? {}) as Record<string, number>
    return {
      users: Number(d.users ?? 0),
      totalBalanceXof: Number(d.total_balance_xof ?? 0),
      depositsXof: Number(d.deposits_xof ?? 0),
      spendXof: Number(d.spend_xof ?? 0),
      refundsXof: Number(d.refunds_xof ?? 0),
      activationsTotal: Number(d.activations_total ?? 0),
      activationsReceived: Number(d.activations_received ?? 0),
      activationsWaiting: Number(d.activations_waiting ?? 0),
    }
  } catch (e) {
    console.log('[v0] adminStats failed:', (e as Error)?.message)
    return EMPTY_STATS
  }
}

export async function adminRecentActivations(limit = 60): Promise<ActivationRow[]> {
  try {
    const { data, error } = await client()
      .from('numbers_activations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return []
    return (data ?? []) as unknown as ActivationRow[]
  } catch (e) {
    console.log('[v0] adminRecentActivations failed:', (e as Error)?.message)
    return []
  }
}

export async function adminRecentTransactions(limit = 60): Promise<TxRow[]> {
  try {
    const { data, error } = await client()
      .from('numbers_wallet_tx')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return []
    return (data ?? []) as unknown as TxRow[]
  } catch (e) {
    console.log('[v0] adminRecentTransactions failed:', (e as Error)?.message)
    return []
  }
}

