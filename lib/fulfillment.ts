// ============================================================
// Logique de "fulfillment" partagee : crediter un achat LIVECAM.
// Utilisee par :
//   - l'approbation admin manuelle (app/api/admin/payments/action)
//   - le paiement automatique GeniusPay (verification statut serveur)
// Tout passe par la cle service_role (createAdminClient).
// ============================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { getGeniusPayPayment, normalizeGeniusPayStatus } from '@/lib/geniuspay'
import { ADMIN_EMAIL } from '@/lib/admin-auth'
import { getPlan, type PlanConfig } from '@/lib/plans'
import { getLiveOffer, type LiveOffer } from '@/lib/live-offers'
import { getInstallOffer, type InstallOffer } from '@/lib/install-offer'
import { getPcOffer, getDesktopDownloadUrl, getDesktopDownloadUrlMac, type PcOffer } from '@/lib/pc-offer'
import { getVoiceOffer, type VoiceOffer } from '@/lib/voice-offers'
import { createPcLicense } from '@/lib/pc-license'
import { grantLiveWindow } from '@/lib/live-access'
import {
  sendSubscriptionApprovedEmail,
  sendLiveAccessApprovedEmail,
  sendInstallationPaidEmail,
  sendPcLicenseEmail,
} from '@/lib/email'

type Admin = ReturnType<typeof createAdminClient>

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Journalise chaque tentative de credit dans payment_logs.
// Ne fait jamais echouer le flux de credit si l'insert echoue.
export async function logPaymentEvent(
  admin: Admin,
  entry: {
    source?: string
    token?: string | null
    transactionId?: string | null
    email?: string | null
    productId?: string | null
    amount?: number
    status?: string
    credited?: boolean
    alreadyDone?: boolean
    creditKind?: string | null
    userLinked?: boolean
    failureReason?: string | null
    raw?: any
  },
) {
  try {
    await admin.from('payment_logs').insert({
      source: entry.source || 'callback',
      token: entry.token || null,
      transaction_id: entry.transactionId || null,
      email: entry.email || null,
      product_id: entry.productId || null,
      amount: entry.amount || 0,
      status: entry.status || null,
      credited: !!entry.credited,
      already_done: !!entry.alreadyDone,
      credit_kind: entry.creditKind || null,
      user_linked: !!entry.userLinked,
      failure_reason: entry.failureReason || null,
      raw: entry.raw ?? null,
    })
  } catch (e) {
    console.error('[fulfillment] Insert payment_logs echoue:', e)
  }
}

// Cherche un compte par email (insensible a la casse). Retourne l'id ou null.
export async function resolveUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  try {
    const target = email.trim().toLowerCase()
    // On parcourt TOUTES les pages jusqu'a epuisement. L'ancien plafond de 10
    // pages (10 000 users) empechait de crediter les paiements des comptes
    // au-dela du 10 000e utilisateur. Plafond de securite large (500 pages =
    // 500 000 users) pour eviter toute boucle infinie.
    for (let page = 1; page <= 500; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      const users = data?.users || []
      const match = users.find((u) => u.email?.toLowerCase() === target)
      if (match) return match.id
      if (users.length < 1000) break
    }
  } catch (e) {
    console.warn('[fulfillment] Resolution user_id impossible:', e)
  }
  return null
}

// Credite les points / active l'abonnement pour un user donne.
export async function activateSubscription(
  admin: Admin,
  userId: string,
  email: string,
  plan: { id: string; price: number; points: number; durationDays: number },
): Promise<{ now: Date; end: Date }> {
  const now = new Date()
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000

  const { data: existing } = await admin
    .from('subscriptions')
    .select('id, points, max_points, end_date, is_active')
    .eq('user_id', userId)
    .maybeSingle()

  // Une recharge CUMULE : on ajoute les points au solde restant et on prolonge
  // la duree a partir de la fin en cours (si encore active), jamais on n'ecrase.
  const prevActive = existing && existing.is_active && existing.end_date
    ? new Date(existing.end_date) > now
    : false
  const prevPoints = prevActive ? Number(existing?.points ?? 0) : 0
  const prevMax = prevActive ? Number(existing?.max_points ?? 0) : 0
  const base = prevActive && existing?.end_date ? new Date(existing.end_date) : now
  const end = new Date(base.getTime() + durationMs)

  const subPayload = {
    user_id: userId,
    email,
    plan: plan.id,
    amount: plan.price,
    status: 'active',
    points: prevPoints + plan.points,
    max_points: prevMax + plan.points,
    is_active: true,
    start_date: now.toISOString(),
    end_date: end.toISOString(),
    expires_at: end.toISOString(),
  }

  if (existing) {
    const { error } = await admin.from('subscriptions').update(subPayload).eq('id', existing.id)
    if (error) console.error('[fulfillment] Erreur update subscription:', error.message)
  } else {
    const { error } = await admin.from('subscriptions').insert(subPayload)
    if (error) console.error('[fulfillment] Erreur insert subscription:', error.message)
  }

  return { now, end }
}

// Credite des MINUTES de voix (ChapVoice / Voice Swap) pour un user donne.
// Comme les recharges de points : les minutes s'ACCUMULENT (ajout au solde
// restant) et l'expiration est prolongee a partir de la fin en cours.
export async function creditVoiceMinutes(
  admin: Admin,
  userId: string,
  offer: { id: string; minutes: number; validityDays: number },
): Promise<{ now: Date; end: Date; secondsRemaining: number }> {
  const now = new Date()
  const addSeconds = Math.round(offer.minutes * 60)
  const durationMs = offer.validityDays * 24 * 60 * 60 * 1000

  const { data: existing } = await admin
    .from('voice_subscriptions')
    .select('id, seconds_remaining, seconds_total, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  const stillValid =
    existing && existing.expires_at ? new Date(existing.expires_at) > now : false
  const prevRemaining = stillValid ? Number(existing?.seconds_remaining ?? 0) : 0
  const prevTotal = stillValid ? Number(existing?.seconds_total ?? 0) : 0
  const base = stillValid && existing?.expires_at ? new Date(existing.expires_at) : now
  const end = new Date(base.getTime() + durationMs)

  const payload = {
    user_id: userId,
    plan: offer.id,
    last_plan: offer.id,
    seconds_remaining: prevRemaining + addSeconds,
    seconds_total: prevTotal + addSeconds,
    expires_at: end.toISOString(),
    updated_at: now.toISOString(),
  }

  if (existing) {
    const { error } = await admin.from('voice_subscriptions').update(payload).eq('id', existing.id)
    if (error) console.error('[fulfillment] Erreur update voice_subscriptions:', error.message)
  } else {
    const { error } = await admin.from('voice_subscriptions').insert(payload)
    if (error) console.error('[fulfillment] Erreur insert voice_subscriptions:', error.message)
  }

  return { now, end, secondsRemaining: prevRemaining + addSeconds }
}

export interface PurchaseInput {
  productId: string // id de formule (plans.ts) OU id d'offre Live (live-offers.ts) OU 'custom'
  email: string
  fullName: string
  userId?: string | null
  amount?: number // pour recharge custom (montant en FCFA, minimum 1000)
}

export interface PurchaseResult {
  ok: boolean
  kind: 'plan' | 'live' | 'installation' | 'pc' | 'voice' | 'numbers_wallet' | null
  userLinked: boolean
  message: string
  licenseKey?: string
}

// Recharge du portefeuille ChapCam Numbers (solde Neon, en FCFA) apres un
// paiement GeniusPay. Independant du catalogue de produits ChapCam.
// L'idempotence est assuree en amont par processed_payments (cle = token).
export async function creditNumbersWallet(input: {
  userId: string | null
  email: string
  amountXof: number
  token: string
}): Promise<PurchaseResult> {
  if (!input.userId) {
    return {
      ok: false,
      kind: 'numbers_wallet',
      userLinked: false,
      message: `Aucun compte LIVECAM ne correspond a ${input.email}.`,
    }
  }
  const amount = Math.round(input.amountXof)
  if (amount <= 0) {
    return { ok: false, kind: 'numbers_wallet', userLinked: true, message: 'Montant de recharge invalide.' }
  }
  const { adjustWallet } = await import('@/lib/numbers/db')
  await adjustWallet(input.userId, amount, {
    kind: 'deposit',
    method: 'geniuspay',
    reference: input.token,
    status: 'completed',
  })
  return {
    ok: true,
    kind: 'numbers_wallet',
    userLinked: true,
    message: `Portefeuille LIVECAM Numbers credite de ${amount} FCFA.`,
  }
}

// Cœur du crediting : determine le type de produit (formule a points OU offre
// Live Pro), credite le bon acces et envoie l'email correspondant.
// Si userId n'est pas fourni, on tente de le resoudre par email.
export async function creditPurchase(
  admin: Admin,
  input: PurchaseInput,
): Promise<PurchaseResult> {
  const isCustom = input.productId === 'custom' || input.productId.startsWith('custom_')
  // Recharge custom : montant libre minimum 1000F, points = amount / 20 (2 pts = 1 sec)
  if (isCustom) {
    const customAmount = Number(input.amount || 0)
    if (!customAmount || customAmount < 1000) {
      return { ok: false, kind: null, userLinked: false, message: 'Montant minimum 1000 F requis.' }
    }
    const customPoints = Math.floor(customAmount / 20)
    let userId = input.userId || null
    if (!userId) userId = await resolveUserIdByEmail(admin, input.email)
    if (!userId) {
      return { ok: false, kind: null, userLinked: false, message: 'Compte introuvable pour ce paiement.' }
    }
    // Créditer les points directement (même logique que les plans)
    const { error: updErr } = await admin
      .from('subscriptions')
      .update({
        points: customPoints,
        max_points: customPoints,
        plan: 'custom',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    // Fallback: si pas de ligne subscriptions, on l'insère
    if (updErr) {
      await admin.from('subscriptions').insert({
        user_id: userId,
        plan: 'custom',
        points: customPoints,
        max_points: customPoints,
        is_active: true,
      })
    }
    // Aussi mettre à jour profiles si existe
    await admin.from('profiles').update({ points: customPoints, max_points: customPoints, plan: 'custom' }).eq('id', userId).then(() => {})
    return { ok: true, kind: 'plan', userLinked: true, message: `Recharge ${customAmount} F créditée (${customPoints} points).` }
  }

  const plan: PlanConfig | undefined = getPlan(input.productId)
  const liveOffer: LiveOffer | undefined = getLiveOffer(input.productId)
  const installOffer: InstallOffer | undefined = getInstallOffer(input.productId)
  const pcOffer: PcOffer | undefined = getPcOffer(input.productId)
  const voiceOffer: VoiceOffer | undefined = getVoiceOffer(input.productId)

  if (!plan && !liveOffer && !installOffer && !pcOffer && !voiceOffer) {
    return { ok: false, kind: null, userLinked: false, message: `Produit inconnu : ${input.productId}` }
  }

  let userId = input.userId || null
  if (!userId) userId = await resolveUserIdByEmail(admin, input.email)

  // ChapCam PC : achat unique a vie. On genere une cle de licence et on
  // l'envoie par email. Aucun compte ChapCam n'est requis (la licence est liee
  // a l'email + au PC du client), donc on traite ce cas AVANT la verification
  // d'un compte existant.
  if (pcOffer) {
    const created = await createPcLicense(admin, { userId, email: input.email })
    if (!created) {
      return {
        ok: false,
        kind: 'pc',
        userLinked: !!userId,
        message: 'Generation de la cle de licence impossible.',
      }
    }
    sendPcLicenseEmail(
      input.email,
      input.fullName,
      created.key,
      getDesktopDownloadUrl(),
      pcOffer.price,
      getDesktopDownloadUrlMac(),
    ).catch((e) => console.error('[fulfillment] Email licence PC echoue:', e))
    return {
      ok: true,
      kind: 'pc',
      userLinked: !!userId,
      message: 'Licence LIVECAM PC generee.',
      licenseKey: created.key,
    }
  }

  if (!userId) {
    return {
      ok: false,
      kind: installOffer ? 'installation' : liveOffer ? 'live' : voiceOffer ? 'voice' : 'plan',
      userLinked: false,
      message: `Aucun compte LIVECAM ne correspond a ${input.email}.`,
    }
  }

  const now = new Date()

  if (installOffer) {
    // Frais d'installation regles : on marque la (les) demande(s) d'installation
    // en attente de ce client comme "payees" pour que l'equipe puisse planifier.
    const { error: updErr } = await admin
      .from('installation_requests')
      .update({ paid: true, paid_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('status', 'pending')
    if (updErr) {
      // Colonnes paid/paid_at peut-etre absentes : on n'echoue pas le credit.
      console.warn('[fulfillment] Maj installation_requests (paid) ignoree:', updErr.message)
    }
    sendInstallationPaidEmail(input.email, input.fullName, installOffer.price).catch((e) =>
      console.error('[fulfillment] Email installation echoue:', e),
    )
    return { ok: true, kind: 'installation', userLinked: true, message: "Frais d'installation regles." }
  }

  if (liveOffer) {
    await grantLiveWindow(admin, userId, 1)
    sendLiveAccessApprovedEmail(
      input.email,
      input.fullName,
      liveOffer.name,
      liveOffer.price,
      liveOffer.windowMinutes,
    ).catch((e) => console.error('[fulfillment] Email Live echoue:', e))
    return { ok: true, kind: 'live', userLinked: true, message: 'Acces Live Pro credite.' }
  }

  if (voiceOffer) {
    const { secondsRemaining } = await creditVoiceMinutes(admin, userId, voiceOffer)
    return {
      ok: true,
      kind: 'voice',
      userLinked: true,
      message: `${voiceOffer.name} credite (${Math.round(secondsRemaining / 60)} min disponibles).`,
    }
  }

  // Formule a points
  const { end } = await activateSubscription(admin, userId, input.email, plan!)
  sendSubscriptionApprovedEmail(
    input.email,
    input.fullName,
    plan!.name,
    plan!.price,
    plan!.points,
    fmtDate(now),
    fmtDate(end),
  ).catch((e) => console.error('[fulfillment] Email abonnement echoue:', e))

  return { ok: true, kind: 'plan', userLinked: true, message: 'Abonnement active.' }
}

// ------------------------------------------------------------
// GeniusPay : verification autoritaire du statut d'un paiement.
// On ne fait JAMAIS confiance au corps d'un callback/retour : on
// reconfirme toujours aupres de l'API GeniusPay (server-to-server,
// X-API-Key + X-API-Secret) avec nos cles serveur.
// ------------------------------------------------------------

export interface GeniusPayConfirm {
  status: string // 'completed' | 'cancelled' | 'pending' | ...
  customData: Record<string, any>
  totalAmount: number
  token: string
  raw: any
}

// Cœur partage : credite un paiement confirme (peu importe la source de la
// confirmation : API GeniusPay). Idempotent.
async function fulfillConfirmedInvoice(params: {
  token: string
  status: string
  totalAmount: number
  customData: Record<string, any>
  source?: string
  transactionId?: string | null
}): Promise<{
  status: 'completed' | 'pending' | 'cancelled' | 'error'
  alreadyDone: boolean
  result?: PurchaseResult
}> {
  const { token, status, totalAmount, customData, source = 'callback', transactionId = null } = params
  const admin = createAdminClient()

  // Retrouver la demande liee a ce token.
  const { data: reqRow } = await admin
    .from('payment_requests')
    .select('*')
    .eq('paydunya_token', token)
    .maybeSingle()

  if (status !== 'completed') {
    const mapped = status === 'cancelled' ? 'cancelled' : 'pending'
    // Anti-spam du journal : le cron de reconciliation re-verifie les memes
    // factures abandonnees toutes les 5 min. On NE journalise PAS ses verifications
    // non-completees (pending/cancelled), sinon la table payment_logs explose
    // (des dizaines de milliers de lignes de bruit). Les sources temps reel
    // (callback / status), elles, sont tracees car utiles au diagnostic.
    if (source !== 'reconcile') {
      await logPaymentEvent(admin, {
        source,
        token,
        transactionId,
        email: reqRow?.email || customData?.email || customData?.user_email || null,
        productId: reqRow?.plan || customData?.product_id || customData?.plan || null,
        amount: totalAmount,
        status: mapped,
        credited: false,
        failureReason:
          mapped === 'cancelled'
            ? 'Paiement annule ou abandonne cote GeniusPay'
            : 'Paiement non complete (statut en attente)',
        raw: customData,
      })
    }
    return { status: mapped, alreadyDone: false }
  }

  // Garde-fou rapide : si la demande liee est deja approuvee, on ne recredite
  // pas (couvre aussi les paiements traites avant la mise en place du verrou).
  if (reqRow && reqRow.status === 'approved') {
    await logPaymentEvent(admin, {
      source,
      token,
      transactionId,
      email: reqRow.email,
      productId: reqRow.plan,
      amount: totalAmount || reqRow.amount,
      status: 'completed',
      credited: true,
      alreadyDone: true,
      userLinked: true,
      raw: customData,
    })
    return { status: 'completed', alreadyDone: true }
  }

  // Metadonnees : priorite a la ligne en base, repli sur custom_data du
  // paiement GeniusPay.
  const cd = customData || {}
  const productId = String(reqRow?.plan || cd.product_id || cd.plan || '')
  const email = String(reqRow?.email || cd.email || cd.user_email || '')
  const fullName = String(reqRow?.full_name || cd.full_name || cd.user_name || 'Client LIVECAM')
  const userId = (reqRow?.user_id as string | null) || (cd.user_id ? String(cd.user_id) : null)

  // Idempotence ATOMIQUE : on tente de "reserver" le token AVANT de crediter.
  // La cle primaire sur processed_payments garantit qu'une seule des sources
  // concurrentes (callback / status / reconcile) reussit l'insert ; les autres
  // recoivent une violation de cle unique et n'ajoutent donc pas de points.
  const { error: claimErr } = await admin.from('processed_payments').insert({
    token,
    email,
    product_id: productId,
    amount: totalAmount,
    credited: false,
  })
  if (claimErr) {
    // 23505 = unique_violation : une ligne existe deja pour ce token. MAIS elle
    // ne signifie "deja credite" que si credited=true. Une ligne credited=false
    // est une RESERVATION ORPHELINE laissee par une tentative precedente qui a
    // plante avant de crediter (ex: erreur Neon transitoire). Dans ce cas, il NE
    // faut SURTOUT PAS conclure "deja fait" (sinon le client paie sans jamais
    // etre credite) : on retente le credit ci-dessous, la reservation servant de verrou.
    const { data: existingClaim } = await admin
      .from('processed_payments')
      .select('credited, created_at')
      .eq('token', token)
      .maybeSingle()
    if (existingClaim?.credited) {
      await logPaymentEvent(admin, {
        source,
        token,
        transactionId,
        email,
        productId,
        amount: totalAmount,
        status: 'completed',
        credited: true,
        alreadyDone: true,
        userLinked: true,
        raw: customData,
      })
      return { status: 'completed', alreadyDone: true }
    }
    // Reservation existante mais credited=false. DEUX cas possibles :
    //  1) Une AUTRE source concurrente (callback / status / reconcile) est EN TRAIN
    //     de crediter a l'instant meme : sa reservation vient d'etre creee et le
    //     credit n'est pas encore marque. Si on "rattrapait" ici, on crediterait
    //     une SECONDE fois le meme paiement (bug du double credit : 500 -> 1000).
    //  2) Une tentative precedente a reellement plante avant de crediter, laissant
    //     une reservation ORPHELINE : la il FAUT retenter, sinon le client paie
    //     sans jamais etre credite.
    // On distingue les deux par l'AGE de la reservation : recente => requete en vol
    // (on renvoie pending, un autre process finira le credit) ; ancienne => orpheline
    // (on retente le credit ci-dessous, la reservation servant de verrou).
    const IN_FLIGHT_GRACE_MS = 3 * 60 * 1000 // 3 min
    const claimAgeMs = existingClaim?.created_at
      ? Date.now() - new Date(existingClaim.created_at).getTime()
      : Number.POSITIVE_INFINITY
    if (claimAgeMs < IN_FLIGHT_GRACE_MS) {
      // Un autre traitement concurrent est en cours : ne PAS re-crediter.
      if (source !== 'reconcile') {
        await logPaymentEvent(admin, {
          source,
          token,
          transactionId,
          email,
          productId,
          amount: totalAmount,
          status: 'pending',
          credited: false,
          failureReason:
            'Credit deja en cours par une autre source (anti double-credit) : on attend',
          raw: customData,
        })
      }
      return { status: 'pending', alreadyDone: false }
    }
    // Reservation orpheline ancienne (credited=false) : on poursuit pour rattraper le credit.
  }

  // Recharge de portefeuille ChapCam Numbers : pas un produit du catalogue,
  // on credite directement le solde Neon. Avec les frais a la charge du
  // client, on credite le NET (metadata.amount_xof / net_amount), JAMAIS le
  // total facture a GeniusPay (totalAmount = net + 100 F + 1% de frais).
  const isNumbersWallet = productId === 'numbers_wallet' || cd.kind === 'numbers_wallet'
  const isCustomProduct = productId === 'custom' || productId.startsWith('custom_')
  const netXof = Number(cd.amount_xof || cd.net_amount || reqRow?.amount || 0) || totalAmount
  // Recharge custom : les points sont calcules sur le net (prix affiche).
  const customNet = isCustomProduct && !isNumbersWallet
    ? Number(cd.net_amount || cd.amount_xof || reqRow?.amount || 0) || totalAmount
    : undefined
  let result: PurchaseResult
  try {
    result = isNumbersWallet
      ? await creditNumbersWallet({
          userId,
          email,
          amountXof: netXof,
          token,
        })
      : await creditPurchase(admin, { productId, email, fullName, userId, amount: customNet })
  } catch (e) {
    // Le credit a JETE une exception (ex: Neon indisponible). Sans ce catch, la
    // reservation processed_payments resterait orpheline (credited=false) et
    // bloquerait DEFINITIVEMENT toute nouvelle tentative. On libere donc le
    // verrou pour que le cron de reconciliation puisse reessayer plus tard.
    await admin.from('processed_payments').delete().eq('token', token)
    const reason = (e as Error)?.message || 'Exception pendant le credit'
    await logPaymentEvent(admin, {
      source,
      token,
      transactionId,
      email,
      productId,
      amount: totalAmount,
      status: 'completed',
      credited: false,
      userLinked: !!userId,
      failureReason: `Credit echoue (exception) : ${reason}`,
      raw: customData,
    })
    return { status: 'error', alreadyDone: false }
  }

  // Marquer le token comme effectivement credite (pour audit).
  if (result.ok) {
    await admin.from('processed_payments').update({ credited: true }).eq('token', token)
  } else {
    // Credit echoue : on libere le token pour permettre une nouvelle tentative
    // (re-credit manuel ou cron de reconciliation).
    await admin.from('processed_payments').delete().eq('token', token)
  }

  // Journaliser le resultat exact du credit (raison precise si echec).
  await logPaymentEvent(admin, {
    source,
    token,
    transactionId,
    email,
    productId,
    amount: totalAmount,
    status: 'completed',
    credited: result.ok,
    creditKind: result.kind,
    userLinked: result.userLinked,
    failureReason: result.ok ? null : result.message,
    raw: customData,
  })

  // Marquer la demande approuvee (si elle existe).
  const now = new Date()
  if (reqRow) {
    await admin
      .from('payment_requests')
      .update({
        status: 'approved',
        validated_at: now.toISOString(),
        paid_amount: totalAmount || reqRow.amount,
        paid_at: now.toISOString(),
        user_id: userId,
      })
      .eq('id', reqRow.id)
      .neq('status', 'approved')

    await admin.from('admin_logs').insert({
      action: 'geniuspay_approve',
      payment_request_id: reqRow.id,
      admin_email: ADMIN_EMAIL,
      details: {
        token,
        product: productId,
        amount: totalAmount,
        kind: result.kind,
        user_linked: result.userLinked,
        auto: true,
      },
    })
  }

  return { status: 'completed', alreadyDone: false, result }
}

// Confirme + credite un paiement GeniusPay de maniere idempotente.
// Appele par la route de statut (resilience si le retour n'arrive jamais),
// le callback et le cron de reconciliation : reconfirme toujours aupres de
// l'API GeniusPay avec nos cles serveur (source de verite).
// `token` = la reference GeniusPay stockee dans payment_requests.
export async function confirmAndFulfillGeniusPay(
  token: string,
  source: string = 'status',
): Promise<{
  status: 'completed' | 'pending' | 'cancelled' | 'error'
  alreadyDone: boolean
  result?: PurchaseResult
  chargedAmount?: number
  netAmount?: number | null
  fee?: number | null
}> {
  const info = await getGeniusPayPayment(token)
  if (!info) {
    // Confirmation impossible (cles invalides, transaction inconnue ou reseau) : on trace.
    try {
      await logPaymentEvent(createAdminClient(), {
        source,
        token,
        status: 'error',
        credited: false,
        failureReason: 'Confirmation GeniusPay impossible (API/reseau ou transaction inconnue)',
      })
    } catch {
      /* noop */
    }
    return { status: 'error', alreadyDone: false }
  }

  // Montants pour affichage transparent des frais (net vs total facture).
  const chargedAmount = info.amount
  const net = Number(info.metadata?.net_amount || info.metadata?.amount_xof || 0)
  const netAmount = Number.isFinite(net) && net > 0 ? net : null
  const fee = netAmount != null ? Math.max(0, chargedAmount - netAmount) : null

  const outcome = await fulfillConfirmedInvoice({
    token,
    status: normalizeGeniusPayStatus(info.status),
    totalAmount: chargedAmount,
    customData: info.metadata,
    source,
    transactionId: info.reference,
  })

  return { ...outcome, chargedAmount, netAmount, fee }
}

// ------------------------------------------------------------
// RECONCILIATION : filet de securite pour le mobile money.
// Beaucoup de clients paient puis ferment le navigateur sans revenir,
// et le retour GeniusPay n'arrive pas toujours. On interroge donc
// GeniusPay pour TOUS les paiements encore "pending" et on :
//   - credite automatiquement ceux "completed" (paye -> credite),
//   - marque "cancelled" ceux abandonnes (nettoie les doublons).
// Idempotent : peut tourner aussi souvent qu'on veut.
// ------------------------------------------------------------
export async function reconcilePendingGeniusPay(opts?: { maxAgeDays?: number; limit?: number }) {
  const admin = createAdminClient()
  const maxAgeDays = opts?.maxAgeDays ?? 7
  const limit = opts?.limit ?? 200
  const since = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows, error } = await admin
    .from('payment_requests')
    .select('id, paydunya_token, created_at')
    .eq('payment_method', 'geniuspay')
    .eq('status', 'pending')
    .not('paydunya_token', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[reconcile] Lecture pending echouee:', error.message)
    return { checked: 0, credited: 0, cancelled: 0, stillPending: 0, errors: 1 }
  }

  let credited = 0
  let cancelled = 0
  let stillPending = 0
  let errors = 0

  for (const row of rows || []) {
    const token = row.paydunya_token as string
    try {
      const r = await confirmAndFulfillGeniusPay(token, 'reconcile')
      if (r.status === 'completed') {
        credited++
      } else if (r.status === 'cancelled') {
        // Nettoyer : le paiement a ete annule/abandonne cote GeniusPay.
        await admin
          .from('payment_requests')
          .update({ status: 'cancelled' })
          .eq('id', row.id)
          .eq('status', 'pending')
        cancelled++
      } else if (r.status === 'error') {
        errors++
      } else {
        stillPending++
      }
    } catch (e) {
      console.error('[reconcile] Token', token, 'echec:', e)
      errors++
    }
  }

  return { checked: rows?.length || 0, credited, cancelled, stillPending, errors }
}
