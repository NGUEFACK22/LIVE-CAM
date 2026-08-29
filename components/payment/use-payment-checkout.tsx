'use client'

import { useCallback, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { CreditCard, Loader2, ShieldCheck, X, Zap } from 'lucide-react'
import { isInAppBrowser } from '@/lib/in-app-browser'
import { InAppBrowserNotice } from '@/components/in-app-browser-notice'

interface StartOptions {
  phoneNumber?: string
  // Cle utilisee pour l'etat de chargement du bouton (defaut : productId).
  loaderKey?: string
}

interface Chooser {
  productId: string
  phoneNumber?: string
  loaderKey: string
  amount?: number
}

const ENDPOINT = '/api/payment/create'

// Hook partage de paiement LIVECAM. Cree un paiement GeniusPay puis redirige
// vers la page de paiement securisee. Gere aussi les navigateurs in-app.
export function usePaymentCheckout() {
  const [chooser, setChooser] = useState<Chooser | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inAppUrl, setInAppUrl] = useState<string | null>(null)

  const startCheckout = useCallback((productId: string, opts?: StartOptions & { amount?: number }) => {
    setError(null)
    setChooser({
      productId,
      phoneNumber: opts?.phoneNumber,
      loaderKey: opts?.loaderKey || productId,
      amount: (opts as any)?.amount,
    })
  }, [])

  const close = useCallback(() => {
    if (pendingKey) return // on ne ferme pas pendant une redirection en cours
    setChooser(null)
    setError(null)
  }, [pendingKey])

  const pay = useCallback(async () => {
    if (!chooser) return
    setError(null)
    setPendingKey(chooser.loaderKey)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: chooser.productId,
          phoneNumber: chooser.phoneNumber,
          amount: chooser.amount,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success && data?.invoice_url) {
        if (isInAppBrowser()) {
          setInAppUrl(data.invoice_url)
          setPendingKey(null)
          return
        }
        window.location.href = data.invoice_url
        return
      }
      setError(data?.error || 'Impossible de demarrer le paiement. Reessayez.')
    } catch {
      setError('Erreur de connexion. Reessayez.')
    } finally {
      setPendingKey(null)
    }
  }, [chooser])

  const modal: ReactNode = (
    <>
      {inAppUrl && <InAppBrowserNotice url={inAppUrl} onClose={() => setInAppUrl(null)} />}
      {chooser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-hairline bg-card shadow-2xl">
            <button
              onClick={close}
              disabled={!!pendingKey}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* En-tete */}
            <div className="border-b border-hairline px-6 pb-5 pt-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h3 className="mt-3 pr-8 text-lg font-bold text-foreground">Finalisez votre paiement</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
                Compte credite automatiquement des la confirmation.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Frais de paiement GeniusPay (100 FCFA + 1%) a la charge du client, inclus dans le montant facture.
              </p>
            </div>

            <div className="px-6 pb-6 pt-5">
              {error && (
                <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              {/* GeniusPay : mobile money / carte */}
              <button
                onClick={() => pay()}
                disabled={!!pendingKey}
                className="group relative flex w-full items-center gap-4 rounded-xl border border-hairline bg-muted/30 p-4 text-left transition-all hover:border-primary hover:bg-muted hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow-sm">
                  Recommande
                </span>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  {pendingKey ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <CreditCard className="h-5 w-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">Mobile Money ou Carte</span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    {[
                      { src: '/images/wave-logo.png', alt: 'Wave' },
                      { src: '/images/orange-money-logo.png', alt: 'Orange Money' },
                      { src: '/images/mtn-momo-logo.jpg', alt: 'MTN MoMo' },
                      { src: '/images/djamo-logo.png', alt: 'Djamo' },
                    ].map((logo) => (
                      <span
                        key={logo.alt}
                        className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-hairline"
                      >
                        <Image src={logo.src} alt={logo.alt} width={20} height={20} className="h-5 w-5 object-contain" />
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">+ carte bancaire</span>
                  </span>
                </span>
                {pendingKey ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                ) : null}
              </button>

              {/* Gages de confiance */}
              <div className="mt-5 flex items-center justify-center gap-4 border-t border-hairline pt-4 text-xs text-text-faint">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  100% securise
                </span>
                <span className="h-3 w-px bg-hairline" />
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  Activation instantanee
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return { startCheckout, pendingKey, error, setError, modal }
}