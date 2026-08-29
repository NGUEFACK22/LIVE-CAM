import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createGeniusPayPayment, geniuspayConfigured } from '@/lib/geniuspay'
import { geniusPayFeeFor, geniusPayTotalToCharge } from '@/lib/geniuspay-fees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_TOPUP_XOF = 500
const MAX_TOPUP_XOF = 1_000_000

// Cree un paiement GeniusPay pour recharger le portefeuille ChapCam Numbers.
// Le montant vient du client mais est borne et valide cote serveur.
// Le credit reel du solde se fait UNIQUEMENT apres reconfirmation GeniusPay
// (source de verite), via custom_metadata.kind = 'numbers_wallet'.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || !user.email) {
      return NextResponse.json(
        { success: false, error: 'Vous devez etre connecte pour recharger.' },
        { status: 401 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const amount = Math.round(Number(body.amountXof || 0))
    if (!Number.isFinite(amount) || amount < MIN_TOPUP_XOF || amount > MAX_TOPUP_XOF) {
      return NextResponse.json(
        { success: false, error: `Montant invalide (min ${MIN_TOPUP_XOF} FCFA).` },
        { status: 400 },
      )
    }

    const fullName =
      String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim() || 'Client LIVECAM'

    // Frais GeniusPay (100 F + 1%) a la charge du client : on facture
    // total = net + frais, mais on CREDITE uniquement le net (amount)
    // au portefeuille (voir lib/fulfillment, metadata.amount_xof).
    const chargeAmount = geniusPayTotalToCharge(amount)
    const fee = geniusPayFeeFor(amount)

    if (!geniuspayConfigured()) {
      console.error('[GeniusPay] Cles API manquantes (topup)')
      return NextResponse.json(
        { success: false, error: 'Configuration GeniusPay incomplete. Contactez le support.' },
        { status: 500 },
      )
    }

    const origin =
      process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin || 'https://chapcam.com'

    const txn = await createGeniusPayPayment({
      description: `LIVECAM Numbers - Recharge portefeuille (${amount} FCFA)`,
      amount: chargeAmount,
      callbackUrl: `${origin}/api/payment/callback`,
      customMetadata: {
        kind: 'numbers_wallet',
        product_id: 'numbers_wallet',
        user_id: user.id,
        email: user.email,
        full_name: fullName,
        amount_xof: amount, // NET credite au portefeuille
        net_amount: amount,
        charged_amount: chargeAmount,
      },
      customer: {
        email: user.email,
        name: fullName,
      },
    })

    if (!txn) {
      return NextResponse.json(
        { success: false, error: 'Le service de paiement est momentanement injoignable. Reessaie dans quelques instants.' },
        { status: 502 },
      )
    }

    // Enregistrer une demande "pending" liee au paiement (reconciliation + audit).
    // Anti-doublon : on reutilise une eventuelle recharge pending du meme client.
    try {
      const admin = createAdminClient()
      const row = {
        full_name: fullName,
        email: user.email,
        phone_number: 'GeniusPay',
        plan: 'numbers_wallet',
        amount,
        wave_transaction_reference: txn.reference,
        status: 'pending',
        user_id: user.id,
        payment_method: 'geniuspay',
        paydunya_token: txn.reference, // colonne historique reutilisee comme token generique
      }
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
      if (existing) {
        await admin.from('payment_requests').update(row).eq('id', existing.id)
      } else {
        await admin.from('payment_requests').insert(row)
      }
    } catch (dbErr) {
      console.error('[GeniusPay] Insert payment_requests (topup) echoue:', dbErr)
    }

    return NextResponse.json({
      success: true,
      token: txn.reference,
      invoice_url: txn.checkoutUrl,
      amount: amount, // NET credite au portefeuille
      charged_amount: chargeAmount, // montant total facture au client
      fee, // dont frais de paiement GeniusPay
    })
  } catch (error) {
    console.error('[GeniusPay] Erreur topup:', error)
    return NextResponse.json({ success: false, error: 'Erreur serveur.' }, { status: 500 })
  }
}