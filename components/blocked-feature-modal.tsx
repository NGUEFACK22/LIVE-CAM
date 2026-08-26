'use client'

import { useState } from 'react'
import { Lock, Zap } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function useBlockedModal() {
  const [open, setOpen] = useState(false)

  const show = () => setOpen(true)
  const hide = () => setOpen(false)

  const Modal = () => (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md bg-card border-hairline">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20">
            <Lock className="h-6 w-6 text-amber-500" />
          </div>
          <DialogTitle className="text-center">Fonctionnalité bloquée</DialogTitle>
          <DialogDescription className="text-center">
            Cette fonctionnalité est temporairement désactivée. Seul le <strong>Live Swap</strong> est disponible.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          <Link href="/dashboard/live-swap" onClick={hide} className="w-full">
            <Button className="w-full bg-primary text-black hover:bg-primary/90">
              <Zap className="mr-2 h-4 w-4" /> Aller au Live Swap
            </Button>
          </Link>
          <Button variant="outline" onClick={hide} className="w-full border-hairline">
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )

  return { show, hide, Modal, open, setOpen }
}

// Composant autonome pour affichage direct (utilisé dans les pages bloquées)
export function BlockedFeatureCard() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20">
          <Lock className="h-8 w-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Fonctionnalité bloquée</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cette fonctionnalité est temporairement désactivée.<br />
          Seul le <strong className="text-foreground">Live Swap</strong> est disponible.
        </p>
        <Link href="/dashboard/live-swap" className="mt-6 inline-flex">
          <Button className="bg-primary text-black hover:bg-primary/90">
            <Zap className="mr-2 h-4 w-4" /> Aller au Live Swap
          </Button>
        </Link>
      </div>
    </div>
  )
}
