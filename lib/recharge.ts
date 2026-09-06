// ============================================================
// Logique de recharge unifiée : crédite le solde points (subscriptions.points)
// 1 point = 20 FCFA. Utilisée par tous les services (numbers, live swap, etc.).
// ============================================================
import { createClient } from '@/lib/supabase/server'
import { createGeniusPayPayment, geniuspayConfigured } from '@/lib/geniuspay'
import { geniusPayFeeFor, geniusPayTotalToCharge } from '@/lib/geniuspay-fees'
import { createAdminClient } from '@/lib/supabase/admin'

export interface RechargeResult {
  token: string          // reference GeniusPay (pour polling status)
  invoiceUrl: string     // URL de paiement hébergée par GeniusPay
  amount: number         // net FCFA à créditer (points = amount / 20)
  chargedAmount: number  // montant total facturé au client (incluant frais)
  fee: number            // frais GeniusPay (fixe + 1%)
}

/**
 * Crée un paiement GeniusPay dont le crédit revient sur le solde unifié
 * (subscriptions.points) via le kind 'numbers_wallet'.
 * Le montant minimum est de 500 FCFA, maximum 1 000 000 FCFA.
 */
export async function createRechargePayment(
  amountXof: number
): Promise<RechargeResult | null> {
  // ---- Validation -------------------------------------------------------
  if (
    !Number.isFinite(amountXof) ||
    amountXof < 500 ||
    amountXof > 1_000_000
  ) {
    console.error('[Recharge] Montant invalide :', amountXof)
    return null
  }

  if (!geniuspayConfigured()) {
    console.error('[Recharge] Configuration GeniusPay manquante')
    return null
  }

  // ---- Authentification -------------------------------------------------
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    console.error('[Recharge] Utilisateur non authentifié')
    return null
  }

  const fullName =
    String(
      user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        ''
    ).trim() || 'Client LIVECAM'

  // ---- Calcul des frais GeniusPay ---------------------------------------
  const chargeAmount = geniusPayTotalToCharge(amountXof)
  const fee = geniusPayFeeFor(amountXof)

  const origin =
    process.env.NEXT_PUBLIC_APP_URL || 'https://chapcam.com'

  // ---- Création du paiement GeniusPay -----------------------------------
  const metadata = {
    kind: 'numbers_wallet',
    product_id: 'recharge',
    user_id: user.id,
    email: user.email,
    full_name: fullName,
    amount_xof: amountXof,
    net_amount: amountXof,
    charged_amount: chargeAmount,
  }

  const txn = await createGeniusPayPayment({
    description: `LIVECAM — Recharge de crédits (${amountXof} FCFA = ${Math.round(
      amountXof / 20
    )} pts, 1 pt = 20 FCFA)`,
    amount: chargeAmount,
    callbackUrl: `${origin}/api/payment/callback?return_to=/recharge`,
    customMetadata: metadata,
    customer: {
      email: user.email,
      name: fullName,
    },
  })

  if (!txn) {
    console.error('[Recharge] Impossible de créer le paiement GeniusPay')
    return null
  }

  // ---- Enregistrement de la demande "pending" (anti-doublon) ------------
  try {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('payment_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('plan', 'numbers_wallet')
      .eq('payment_method', 'geniuspay')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const row = {
      full_name: fullName,
      email: user.email,
      phone_number: 'GeniusPay',
      plan: 'numbers_wallet',
      amount: amountXof,
      wave_transaction_reference: txn.reference,
      status: 'pending',
      user_id: user.id,
      payment_method: 'geniuspay',
      paydunya_token: txn.reference,
    }

    if (existing) {
      await admin.from('payment_requests').update(row).eq('id', existing.id)
    } else {
      await admin.from('payment_requests').insert(row)
    }
  } catch (dbErr) {
    // On n'échoue pas le paiement si l'insertion échoue ; le callback
    // pourra encore crediter via custom_metadata. On log seulement.
    console.error('[Recharge] Insert payment_requests echoue:', dbErr)
  }

  return {
    token: txn.reference,
    invoiceUrl: txn.checkoutUrl,
    amount: amountXof,
    chargedAmount: chargeAmount,
    fee,
  }
}