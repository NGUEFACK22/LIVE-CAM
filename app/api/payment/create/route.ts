import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlan } from '@/lib/plans'
import { getLiveOffer } from '@/lib/live-offers'
import { getInstallOffer } from '@/lib/install-offer'
import { getPcOffer } from '@/lib/pc-offer'
import { getVoiceOffer } from '@/lib/voice-offers'
import { createGeniusPayPayment, geniuspayConfigured } from '@/lib/geniuspay'
import { geniusPayFeeFor, geniusPayTotalToCharge } from '@/lib/geniuspay-fees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cree un paiement GeniusPay pour une formule a points OU l'offre Live Pro.
// Le montant et le libelle sont calcules cote serveur (source de verite),
// jamais a partir du corps de la requete.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || !user.email) {
      return NextResponse.json(
        { success: false, error: 'Vous devez etre connecte pour payer.' },
        { status: 401 },
      )
    }

    const body = await request.json().catch(() => ({}))
    const productId = String(body.productId || body.plan || '')
    const fullName =
      String(body.fullName || user.user_metadata?.full_name || '').trim() || 'Client LIVECAM'
    const phoneNumber = String(body.phoneNumber || '').trim()

    // Determiner le produit : formule a points, offre Live Pro, frais
    // d'installation ou achat unique ChapCam PC.
    const plan = getPlan(productId)
    const liveOffer = getLiveOffer(productId)
    const installOffer = getInstallOffer(productId)
    const pcOffer = getPcOffer(productId)
    const voiceOffer = getVoiceOffer(productId)
    // Recharge custom (montant libre, minimum 1000F) - sans abonnement
    const isCustom = productId === 'custom' || productId.startsWith('custom_')
    let customAmount = 0
    if (isCustom) {
      customAmount = Number(body.amount || body.customAmount || 0)
      if (!customAmount || customAmount < 1000) {
        return NextResponse.json({ success: false, error: 'Montant minimum 1000 F requis.' }, { status: 400 })
      }
    }
    if (!plan && !liveOffer && !installOffer && !pcOffer && !voiceOffer && !isCustom) {
      return NextResponse.json({ success: false, error: 'Produit inconnu.' }, { status: 400 })
    }

    const amount = isCustom
      ? customAmount
      : plan
        ? plan.price
        : liveOffer
          ? liveOffer.price
          : installOffer
            ? installOffer.price
            : pcOffer
              ? pcOffer.price
              : voiceOffer!.price
    // Frais GeniusPay (100 F + 1%) a la charge du client : le montant
    // FACTURE a GeniusPay inclut les frais, le montant NET (credite au
    // client) reste le prix affiche ci-dessus.
    const chargeAmount = geniusPayTotalToCharge(amount)
    const kind: 'plan' | 'live' | 'installation' | 'pc' | 'voice' = isCustom
      ? 'plan'
      : plan
        ? 'plan'
        : liveOffer
          ? 'live'
          : installOffer
            ? 'installation'
            : pcOffer
              ? 'pc'
              : 'voice'
    const customPoints = isCustom ? Math.floor(customAmount / 20) : 0
    const customMinutes = isCustom ? `${Math.floor(customPoints / 60)} min ${customPoints % 60} sec` : ''
    const label = isCustom
      ? `Recharge ${customAmount.toLocaleString()} F (${customPoints} points, ${customMinutes})`
      : plan
        ? `Formule ${plan.name} (${plan.points} points, ${plan.duration})`
        : liveOffer
          ? `${liveOffer.name} (${liveOffer.windowMinutes} min d'acces Live)`
          : installOffer
            ? installOffer.name
            : pcOffer
              ? `${pcOffer.name} (licence a vie)`
              : `${voiceOffer!.name} (${voiceOffer!.minutes} min de voix)`

    if (!geniuspayConfigured()) {
      console.error('[GeniusPay] Cles API manquantes')
      return NextResponse.json(
        { success: false, error: 'Configuration GeniusPay incomplete. Contactez le support.' },
        { status: 500 },
      )
    }

    // Base URL publique : l'origine de la requete (fonctionne en preview + prod),
    // avec repli sur l'env / le domaine de prod.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin || 'https://chapcam.com'

    // GeniusPay redirige le navigateur du client vers success_url/error_url apres
    // le checkout. On ne s'y fie pas : la source de verite est la reconfirmation
    // API (app/api/payment/status) apres ce retour.
    const txn = await createGeniusPayPayment({
      description: `LIVECAM - ${label}`,
      amount: chargeAmount,
      callbackUrl: `${origin}/api/payment/callback`,
      customMetadata: {
        kind,
        product_id: productId,
        user_id: user.id,
        email: user.email,
        full_name: fullName,
        net_amount: amount,
        charged_amount: chargeAmount,
      },
      customer: {
        email: user.email,
        name: fullName,
        phone: phoneNumber,
      },
    })

    if (!txn) {
      return NextResponse.json(
        { success: false, error: "Le service de paiement est momentanement injoignable. Reessaie dans quelques instants." },
        { status: 502 },
      )
    }

    // Enregistrer / mettre a jour une demande "pending" liee au paiement
    // GeniusPay (reconciliation + audit).
    // ANTI-DOUBLON : si ce client a deja une demande "pending" GeniusPay pour le
    // meme produit (il a clique plusieurs fois / abandonne sans payer), on
    // REUTILISE cette ligne en y mettant le nouveau token, au lieu d'en creer
    // une nouvelle. Resultat : une seule ligne par client + produit.
    try {
      const admin = createAdminClient()
      const row = {
        full_name: fullName,
        email: user.email,
        phone_number: phoneNumber,
        plan: productId,
        amount,
        wave_transaction_reference: txn.reference, // reference GeniusPay (UNIQUE)
        status: 'pending',
        user_id: user.id,
        payment_method: 'geniuspay',
        paydunya_token: txn.reference, // colonne historique reutilisee comme token generique
      }

      const { data: existing } = await admin
        .from('payment_requests')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan', productId)
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
      // On n'echoue pas le paiement si l'insert echoue : le callback peut encore
      // crediter via custom_metadata. On log seulement.
      console.error('[GeniusPay] Insert payment_requests echoue:', dbErr)
    }

    return NextResponse.json({
      success: true,
      token: txn.reference,
      invoice_url: txn.checkoutUrl,
      amount: amount, // montant net credite (prix affiche)
      charged_amount: chargeAmount, // montant total facture au client
      fee: geniusPayFeeFor(amount), // dont frais de paiement GeniusPay
    })
  } catch (error) {
    console.error('[GeniusPay] Erreur create:', error)
    return NextResponse.json({ success: false, error: 'Erreur serveur.' }, { status: 500 })
  }
}