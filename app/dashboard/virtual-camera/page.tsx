'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Maximize2, Minimize2, Zap, Share2 } from 'lucide-react'
import { useLucy21 } from '@/hooks/use-lucy-21'
import { createClient } from '@/lib/supabase/client'

export default function VirtualCameraPage() {
  const [avatars, setAvatars] = useState<any[]>([])
  const [selectedAvatar, setSelectedAvatar] = useState<any>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'error'>('idle')
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    isConnected,
    isConnecting,
    error,
    remoteVideoRef,
    connect,
    disconnect,
  } = useLucy21()

  // Charger les avatars
  useEffect(() => {
    const loadAvatars = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('user_avatars')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (data) {
        setAvatars(data)
        const active = data.find((a: any) => a.is_active)
        if (active) setSelectedAvatar(active)
      }
    }
    loadAvatars()
  }, [])

  // Démarrer le swap avec l'avatar sélectionné
  const startVirtualCam = async () => {
    if (!selectedAvatar) return
    await connect(selectedAvatar.url)
  }

  const stopVirtualCam = () => {
    disconnect()
  }

  // Toggle fullscreen
  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Partager l'onglet (pour les appels vidéo)
  const shareTab = async () => {
    try {
      setShareStatus('sharing')
      await navigator.share({
        title: 'ChapCam Virtual Camera',
        url: window.location.href,
      })
    } catch (e) {
      // Fallback : inciter à utiliser le partage d'écran
      setShareStatus('error')
    }
  }

  return (
    <div ref={containerRef} className="flex h-screen flex-col bg-black">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-4">
        <Link
          href="/dashboard/live-swap"
          className="flex items-center gap-2 rounded-lg bg-black/50 px-3 py-1.5 text-sm text-foreground backdrop-blur-md transition-colors hover:bg-black/70"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </Link>

        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-bold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              EN DIRECT
            </span>
          )}

          <button
            onClick={toggleFullscreen}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-foreground transition-colors hover:bg-black/70"
            title={isFullscreen ? 'Réduire' : 'Plein écran'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            onClick={shareTab}
            className="flex items-center gap-1.5 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
            title="Partager cette page"
          >
            <Share2 className="h-3.5 w-3.5" /> Partager
          </button>
        </div>
      </div>

      {/* Zone vidéo principale */}
      <div className="flex flex-1 items-center justify-center">
        <div className="relative aspect-video w-full max-w-5xl">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {!isConnected && !isConnecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
              <Zap className="mb-4 h-16 w-16 text-primary" />
              <p className="mb-2 text-xl font-bold text-foreground">Caméra ChapCam Virtuelle</p>
              <p className="mb-6 text-sm text-muted-foreground">
                Activez le swap pour transformer votre apparence
              </p>

              <div className="mb-4">
                <select
                  value={selectedAvatar?.id || ''}
                  onChange={(e) => {
                    const avatar = avatars.find((a: any) => a.id === e.target.value)
                    setSelectedAvatar(avatar)
                  }}
                  className="rounded-lg border border-hairline bg-black/50 px-4 py-2 text-sm text-foreground backdrop-blur-md"
                >
                  <option value="">Choisir un avatar...</option>
                  {avatars.map((avatar: any) => (
                    <option key={avatar.id} value={avatar.id}>
                      {avatar.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={startVirtualCam}
                disabled={!selectedAvatar}
                className="rounded-lg bg-primary px-6 py-3 font-bold text-black transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                Démarrer la Caméra Virtuelle
              </button>
            </div>
          )}

          {isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center">
                <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-foreground">Connexion en cours...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions de partage */}
      {isConnected && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="mx-auto max-w-2xl rounded-xl border border-primary/30 bg-black/50 p-3 backdrop-blur-md">
            <p className="text-xs font-semibold text-primary mb-1">Pour utiliser dans un appel vidéo :</p>
            <ol className="text-[11px] text-foreground/70 space-y-1">
              <li>1. Cliquez sur l'icône "Partager l'écran" dans votre app de visioconférence</li>
              <li>2. Sélectionnez l'onglet "ChapCam Virtual Camera" ou toute la fenêtre</li>
              <li>3. Le flux transformé par l'IA sera visible par les autres participants</li>
            </ol>
          </div>
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div className="absolute bottom-20 left-0 right-0 mx-auto w-fit max-w-md rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}