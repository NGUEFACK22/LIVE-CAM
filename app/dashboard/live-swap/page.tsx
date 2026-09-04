'use client'

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Camera, Zap, Clock, Coins, Plus, Check, AlertCircle, AlertTriangle, Loader2, Square, Wifi, WifiOff, Monitor, Cloud, Settings, Download, ClipboardList, Mic, MicOff, Video as VideoIcon, VideoOff, BookOpen, Languages, ImageIcon, Film, ArrowRight, Maximize2, Minimize2, AudioLines, Share2, ExternalLink, Tv, Lock, Crown } from 'lucide-react'
import { useLucy21 } from '@/hooks/use-lucy-21'
import { isElectron } from '@/lib/electron'
import { InstallationRequestModal } from '@/components/dashboard/installation-request-modal'
import { VirtualCameraIndicator } from '@/components/live/virtual-camera-indicator'
import { SwapConsent, GenerateNotice } from '@/components/dashboard/swap-consent'
import { detectHardwareCapabilities, determineProcessingMode, loadProcessingPreferences, saveProcessingPreferences, type HardwareCapabilities, type UserProcessingPreferences } from '@/lib/hardware-detection'
import { FREE_UNLIMITED_POINTS, isFreeLiveSwap } from '@/lib/free-mode'
import { emitPointsUpdate } from '@/lib/points-events'
import { useBlockedModal } from '@/components/blocked-feature-modal'

import { createClient } from '@/lib/supabase/client'

// 1 credit = 1 seconde de swap
const POINTS_PER_SECOND = 1
const FREE_MODE = isFreeLiveSwap()

interface Avatar {
  id: string
  name: string
  url: string
  is_active: boolean
}

export default function DashboardPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null)
  const [userPoints, setUserPoints] = useState(0)
  const [maxPoints, setMaxPoints] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [pointsUsed, setPointsUsed] = useState(0)
  const [isSyncingPoints, setIsSyncingPoints] = useState(false)
  // Refs miroir : utilisees dans les intervalles / handlers de fermeture pour
  // eviter les closures perimees (bug qui empechait toute deduction).
  const durationRef = useRef(0)          // duree totale du swap en cours (s)
  const pointsUsedRef = useRef(0)        // total points consommes ce swap
  const pendingSyncRef = useRef(0)       // points consommes NON encore envoyes au serveur
  const remainingRef = useRef(0)         // solde restant estime (pour couper a 0)
  // Ref vers handleStopSwapAndSave : casse la dépendance circulaire entre
  // syncPendingPoints (coupe le swap quand le solde tombe à 0) et
  // handleStopSwapAndSave (flush des points restants).
  const handleStopSwapAndSaveRef = useRef<() => Promise<void>>(async () => {})
  // Certification d'usage responsable, requise avant chaque demarrage de swap.
  const [swapConsent, setSwapConsent] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  // Detection hardware et mode de traitement
  const [hardware, setHardware] = useState<HardwareCapabilities | null>(null)
  // IMPORTANT : on initialise avec les MEMES valeurs par defaut que le rendu
  // serveur. Lire localStorage ici (pendant le rendu) provoquait un mismatch
  // d'hydratation (React #418) qui faisait planter toute la page Live.
  // Les vraies preferences sont chargees apres le montage dans un useEffect.
  const [preferences, setPreferences] = useState<UserProcessingPreferences>({
    mode: 'auto',
    maxLocalFPS: 25,
    preferQuality: true,
    forceCloud: false,
  })
  const [processingMode, setProcessingMode] = useState<'local' | 'cloud'>('cloud')
  const [networkQuality, setNetworkQuality] = useState<'good' | 'medium' | 'poor'>('good')
  const [showModeSettings, setShowModeSettings] = useState(false)
  const [stats, setStats] = useState({ fps: 0, latency: 0, resolution: '720p' })
  const [showInstallModal, setShowInstallModal] = useState(false)

  // Reglages visuels (modernisation UI uniquement - n'affecte pas la logique du swap)
  const [renderQuality, setRenderQuality] = useState<'standard' | 'hd' | 'ultra'>('ultra')
  const [stability, setStability] = useState(80)
  const [smoothing, setSmoothing] = useState(70)
  const [noiseReduction, setNoiseReduction] = useState(60)
  const [faceOrientation, setFaceOrientation] = useState<'left' | 'center' | 'right'>('center')
  const [colorCorrection, setColorCorrection] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  // Détection de l'app de bureau (Electron) : sans état ni effet, lue une
  // seule fois au montage (useSyncExternalStore) pour éviter tout flash SSR.
  const isDesktop = useSyncExternalStore(
    () => () => {},
    () => isElectron(),
    () => false,
  )

  // Mode Stream : affiche UNIQUEMENT la sortie ChapCam en plein ecran dans la
  // fenetre, pour qu'OBS capture l'avatar SANS l'interface (sidebar, header...).
  const [streamMode, setStreamMode] = useState(false)
  // Dimensions de la video de sortie (pour diagnostic)
  const [remoteVideoDims, setRemoteVideoDims] = useState<{ w: number; h: number } | null>(null)
  // Feedback bouton "Diagnostic" (copie des logs dans le presse-papiers)
  const [debugCopied, setDebugCopied] = useState(false)

  const chapCamRef = useRef<HTMLDivElement | null>(null)
  const [isCamFullscreen, setIsCamFullscreen] = useState(false)
  const [mirrorOutput, setMirrorOutput] = useState(false)

  const toggleCamFullscreen = useCallback(() => {
    const el = chapCamRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsCamFullscreen(document.fullscreenElement === chapCamRef.current)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Use Lucy hook - must be called before useEffects that use its values
  const {
    isConnected,
    isConnecting,
    error,
    clearError,
    demoMode,
    localVideoRef,
    remoteVideoRef,
    connect,
    disconnect,
    updateAvatar,
    checkAccess,
    connectionState,
  } = useLucy21()

  // Camera virtuelle (app de bureau) : NI le mode Stream NI la camera
  // virtuelle (OBS / pilote) ne se lancent automatiquement au demarrage du
  // Live Swap. L'utilisateur active manuellement le bouton "Stream" quand il
  // veut une sortie plein ecran pour OBS, et lance OBS via l'indicateur
  // "Pret a diffuser" quand il est pret a diffuser vers WhatsApp/Zoom.
  // (Ancien comportement retire le 19/08 : le double demarrage automatique
  // provoquait des boucles kill/relance OBS — ~60 s de sortie noire.)

  // Suivi des dimensions de la video de sortie (diagnostic)
  useEffect(() => {
    if (!isConnected) return
    const interval = setInterval(() => {
      const el = remoteVideoRef.current
      if (el && el.videoWidth > 0 && el.videoHeight > 0) {
        setRemoteVideoDims({ w: el.videoWidth, h: el.videoHeight })
      }
    }, 2000)
    return () => {
      clearInterval(interval)
      // Reset au démontage / déconnexion (cleanup, pas de setState synchrone
      // dans le corps de l'effet).
      setRemoteVideoDims(null)
    }
  }, [isConnected, remoteVideoRef])

  // ============================================================================
  // MODE STREAM MANUEL UNIQUEMENT : le mode Stream (plein ecran de la sortie
  // ChapCam pour la capture OBS) ne se lance PLUS automatiquement au demarrage
  // du Live Swap. L'utilisateur l'active quand il le souhaite via le bouton
  // "Stream" (Tv) et le quitte via "Quitter Stream" ou Echap.
  // L'ancien useEffect auto-forcait streamMode=true des la connexion, ce qui
  // masquait brutalement toute l'interface sans action de l'utilisateur.
  // Note : en mode Stream actif, le miroir CSS de la sortie est desactive par
  // le rendu (isStreamActive), l'avatar reste dans le bon sens pour OBS.
  // ============================================================================
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStreamMode(false)
    }
    if (!streamMode) return
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [streamMode])

  // Instance Supabase stable (memoïsée) : peut figurer dans les deps des effets.
  const supabase = useMemo(() => createClient(), [])

  // Charger les preferences sauvegardees uniquement cote client (apres montage)
  // pour eviter tout mismatch d'hydratation avec le rendu serveur. Lecture
  // différée d'un tick pour éviter un setState synchrone dans l'effet.
  useEffect(() => {
    const t = setTimeout(() => setPreferences(loadProcessingPreferences()), 0)
    return () => clearTimeout(t)
  }, [])

  // Detecter le hardware au montage
  useEffect(() => {
    async function detectHardware() {
      const caps = await detectHardwareCapabilities()
      setHardware(caps)

      // Si PC gamer detecte, forcer le mode local obligatoirement
      if (caps.isGamingPC) {
        setProcessingMode('local')
        // Garde anti-boucle : l'effet a `preferences` dans ses deps, on ne
        // réécrit donc les préférences que si elles ne sont pas déjà en local.
        if (preferences.mode !== 'local') {
          const forcedPrefs = { ...preferences, mode: 'local' as const }
          setPreferences(forcedPrefs)
          saveProcessingPreferences(forcedPrefs)
        }
        setStats(prev => ({ ...prev, resolution: caps.gpuTier === 'high' ? '1080p' : '720p', fps: caps.gpuTier === 'high' ? 30 : 25 }))
      } else {
        // PC classique: determiner le mode optimal (cloud par defaut)
        const mode = determineProcessingMode(caps, preferences, networkQuality)
        setProcessingMode(mode.mode)
        setStats(prev => ({ ...prev, resolution: mode.resolution, fps: mode.fps }))
      }
    }
    detectHardware()
  }, [networkQuality, preferences])

  // Surveiller la qualite reseau
  useEffect(() => {
    if ('connection' in navigator) {
      const connection = (navigator as Navigator & { connection?: { effectiveType: string; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } }).connection
      if (connection) {
        const updateNetworkQuality = () => {
          const type = connection.effectiveType
          if (type === '4g') setNetworkQuality('good')
          else if (type === '3g') setNetworkQuality('medium')
          else setNetworkQuality('poor')
        }
        updateNetworkQuality()
        connection.addEventListener?.('change', updateNetworkQuality)
        return () => connection.removeEventListener?.('change', updateNetworkQuality)
      }
    }
  }, [])

  // Load user data
  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      setUserId(user.id)

      // Charger les points via l'API
      try {
        const pointsRes = await fetch('/api/points')
        const pointsData = await pointsRes.json().catch(() => null)
        if (pointsData?.success) {
          setUserPoints(pointsData.points ?? 0)
          setMaxPoints(pointsData.maxPoints ?? 0)
          remainingRef.current = pointsData.points ?? 0
        }
      } catch (err) {
        console.error('Erreur chargement points:', err)
      }

      const { data: avatarsData } = await supabase
        .from('user_avatars')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (avatarsData && avatarsData.length > 0) {
        setAvatars(avatarsData)
        const activeAvatar = avatarsData.find((a: { is_active: boolean }) => a.is_active)
        if (activeAvatar) setSelectedAvatar(activeAvatar)
      }
    }

    loadData()
  }, [supabase])

  // Envoie au serveur les points consommes mais pas encore synchronises.
  // Utilise des refs -> aucune closure perimee. Rejoue le lot en cas d'echec.
  const syncPendingPoints = useCallback(async () => {
    const chunk = pendingSyncRef.current
    if (chunk <= 0) return
    pendingSyncRef.current = 0
    try {
      const res = await fetch('/api/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true, // permet a la requete d'aboutir meme si l'onglet se ferme
        body: JSON.stringify({
          pointsToDeduct: chunk,
          sessionDuration: Math.max(1, Math.round(chunk / POINTS_PER_SECOND)),
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.success) {
        setMaxPoints(data.maxPoints ?? 0)
        if (typeof data.currentPoints === 'number') {
          remainingRef.current = data.currentPoints
          setUserPoints(data.currentPoints)
          // Sidebar temps reel : solde REEL en base apres deduction serveur.
          emitPointsUpdate(data.currentPoints, data.maxPoints)
        }
        if (data.depleted) handleStopSwapAndSaveRef.current()
      } else {
        // Echec -> on remet le lot en attente pour re-essayer au prochain tick.
        pendingSyncRef.current += chunk
      }
    } catch (err) {
      console.error('Erreur sync points:', err)
      pendingSyncRef.current += chunk
    }
  }, [])

  // Track points usage en temps reel + synchronisation serveur periodique.
  // En mode gratuit : on compte seulement la duree, sans deduction ni arret.
  useEffect(() => {
    if (!isConnected) return
    const SYNC_EVERY_SECONDS = 10
    const interval = setInterval(() => {
      durationRef.current += 1
      setDuration(durationRef.current)

      if (FREE_MODE) {
        remainingRef.current = FREE_UNLIMITED_POINTS
        setUserPoints(FREE_UNLIMITED_POINTS)
        return
      }

      pointsUsedRef.current += POINTS_PER_SECOND
      pendingSyncRef.current += POINTS_PER_SECOND
      remainingRef.current = Math.max(0, remainingRef.current - POINTS_PER_SECOND)

      setPointsUsed(pointsUsedRef.current)
      setUserPoints(remainingRef.current)
      // Sidebar temps reel : decrement local fluide (1 pt/s). La valeur est
      // corrigee par le solde serveur a chaque synchronisation (10 s).
      emitPointsUpdate(remainingRef.current)

      // Synchronisation reguliere : on ne perd jamais plus de ~10s de conso.
      if (durationRef.current % SYNC_EVERY_SECONDS === 0) {
        void syncPendingPoints()
      }

      // Solde epuise -> couper le swap et sauvegarder le reste.
      if (remainingRef.current <= 0) {
        handleStopSwapAndSaveRef.current()
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [isConnected, syncPendingPoints])

  // Flush de securite quand l'onglet se ferme / passe en arriere-plan / navigation.
  // sendBeacon garantit l'envoi meme pendant la fermeture de la page.
  useEffect(() => {
    const flushBeacon = () => {
      const chunk = pendingSyncRef.current
      if (chunk <= 0) return
      pendingSyncRef.current = 0
      try {
        const blob = new Blob([JSON.stringify({
          pointsToDeduct: chunk,
          sessionDuration: Math.max(1, Math.round(chunk / POINTS_PER_SECOND)),
        })], { type: 'application/json' })
        navigator.sendBeacon?.('/api/points', blob)
      } catch {
        pendingSyncRef.current += chunk
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushBeacon() }
    window.addEventListener('pagehide', flushBeacon)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushBeacon)
      document.removeEventListener('visibilitychange', onVisibility)
      flushBeacon() // flush au demontage (navigation interne vers une autre page)
    }
  }, [])

  // Arrete le swap et sauvegarde le reste des points consommes.
  // Toujours disconnect en premier (coupe camera + Decart + vcam), puis
  // flush des points — meme si un sync est deja en cours (on re-tente).
  const handleStopSwapAndSave = useCallback(async () => {
    // Couper d'abord le flux (arrete la conso cote UI via isConnected=false).
    try {
      disconnect()
    } catch (err) {
      console.error('[live-swap] Erreur disconnect:', err)
    }

    // Flush des points restants (best-effort).
    if (!isSyncingPoints && pendingSyncRef.current > 0) {
      setIsSyncingPoints(true)
      try {
        await syncPendingPoints()
      } catch (err) {
        console.error('[live-swap] Erreur sync points a l\'arret:', err)
      } finally {
        setIsSyncingPoints(false)
      }
    }

    // Reset des compteurs de session (UI)
    setPointsUsed(0)
    setDuration(0)
    pointsUsedRef.current = 0
    durationRef.current = 0
  }, [disconnect, isSyncingPoints, syncPendingPoints])

  // Expose la version à jour de handleStopSwapAndSave via une ref (les
  // intervalles l'appellent via la ref pour éviter closures périmées et
  // dépendance circulaire).
  useEffect(() => {
    handleStopSwapAndSaveRef.current = handleStopSwapAndSave
  }, [handleStopSwapAndSave])

  // === TRACKING UTILISATEURS ACTIFS ===
  useEffect(() => {
    const trackActivity = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Le tracking d'activite est purement "best effort" : si la table
        // user_activity n'existe pas / n'a pas de contrainte unique sur
        // user_id (erreur 400), on ignore silencieusement pour ne JAMAIS
        // faire planter la page Live.
        const { error: activityError } = await supabase
          .from('user_activity')
          .upsert({
            user_id: user.id,
            last_active: new Date().toISOString(),
            current_page: window.location.pathname,
          }, {
            onConflict: 'user_id',
          })

        if (activityError) {
          console.warn('[live-swap] Suivi activite ignore:', activityError.message)
        }
      } catch (err) {
        console.warn('[live-swap] Suivi activite indisponible:', err)
      }
    }

    trackActivity()
    const interval = setInterval(trackActivity, 30000)

    return () => clearInterval(interval)
  }, [supabase])

  const handleStartSwap = async () => {
    if (!selectedAvatar || !swapConsent) return
    if (isConnecting || isConnected) return
    if (!FREE_MODE && userPoints < POINTS_PER_SECOND) return

    // Nettoyer les erreurs d'une tentative precedente.
    setAccessError(null)
    clearError()

    try {
      // Check access before starting (validates trial/paid status with server)
      const access = await checkAccess()
      if (!access.canStart) {
        setAccessError(access.error || 'Accès au Live Swap refusé')
        return
      }

      // Journalisation de l'acceptation de la certification d'usage responsable.
      console.log('[v0] swap-consent accepted', {
        type: 'live-face-swap',
        userId,
        avatarId: selectedAvatar.id,
        acceptedAt: new Date().toISOString(),
      })
      setDuration(0)
      setPointsUsed(0)
      // Init des refs de suivi pour cette session (evite toute closure perimee).
      durationRef.current = 0
      pointsUsedRef.current = 0
      pendingSyncRef.current = 0
      remainingRef.current = FREE_MODE ? FREE_UNLIMITED_POINTS : userPoints
      await connect(selectedAvatar.url)

      // NB : aucune activation automatique de la diffusion OBS / camera
      // virtuelle ici (voir commentaire plus haut) — l'utilisateur la lance
      // manuellement quand il en a besoin.
    } catch (err: unknown) {
      console.error('[live-swap] Erreur demarrage swap:', err)
      const message =
        err instanceof Error ? err.message : 'Impossible de démarrer le Live Swap'
      setAccessError(message)
    }
  }

  const handleStopSwap = () => {
    void handleStopSwapAndSave()
  }

  const handleSelectAvatar = async (avatar: Avatar) => {
    setSelectedAvatar(avatar)

    if (userId) {
      await supabase.from('user_avatars').update({ is_active: false }).eq('user_id', userId)
      await supabase.from('user_avatars').update({ is_active: true }).eq('id', avatar.id)
      setAvatars(prev => prev.map(a => ({ ...a, is_active: a.id === avatar.id })))
    }

    if (isConnected) {
      try {
        await updateAvatar(avatar.url)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleModeChange = useCallback((mode: 'auto' | 'local' | 'cloud') => {
    // Si PC gamer, ignorer tout changement et rester en local
    if (hardware?.isGamingPC) {
      return
    }

    const newPrefs = { ...preferences, mode }
    setPreferences(newPrefs)
    saveProcessingPreferences(newPrefs)

    if (hardware) {
      const result = determineProcessingMode(hardware, newPrefs, networkQuality)
      setProcessingMode(result.mode)
    }
    setShowModeSettings(false)
  }, [hardware, networkQuality, preferences])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const canStart =
    !!selectedAvatar &&
    swapConsent &&
    (FREE_MODE || userPoints >= POINTS_PER_SECOND)

  const quickTools = [
    { href: '/dashboard/voice-swap', label: 'Voice Swap', icon: AudioLines, color: '#8b5cf6' },
    { href: '/dashboard/voice-translator', label: 'Voice Traducteur', icon: Languages, color: '#3b82f6' },
    { href: '/dashboard/photo-video', label: 'Photos → Vidéo', icon: ImageIcon, color: '#f97316' },
    { href: '/dashboard/video-translation', label: 'Traduction Vidéo', icon: Film, color: '#8b5cf6' },
  ]

  // ============================================================================
  // STREAM MODE (capture OBS) : en mode desktop connecte, on veut qu'OBS capture
  // UNIQUEMENT l'avatar — sans UI, sans spinner, et SANS mirror CSS (le mirror
  // est un confort local pour l'utilisateur, pas pour le correspondant qui doit
  // voir l'avatar dans le bon sens).
  //
  // Implementation : on garde le MEME arbre DOM (sinon le flux video serait
  // detruit/recree), mais on cache tout le reste et on positionne le conteneur
  // de la camera ChapCam en plein ecran fixed. OBS capture la fenetre -> il ne
  // voit que l'avatar, nettoie et dans le bon sens.
  // ============================================================================
  const isStreamActive = streamMode && isDesktop && isConnected
  const { show: showBlocked, Modal: BlockedModal } = useBlockedModal()

  return (
    <div className={isStreamActive ? 'cc-stream-root' : 'p-4 md:p-6 space-y-6'}>
      {/* Le bouton Quitter Stream est rendu PAR le stage (cc-cam-stage) lui-meme
          pour rester au-dessus de la video en mode Stream. */}
      {/* En Stream Mode, cache TOUS les elements SAUF le stage de la camera
          ChapCam (cc-cam-stage). On utilise une regle CSS injectee pour ne pas
          avoir a modifier chaque element un par un. */}
      {isStreamActive && (
        <style>{`
          /**
           * STREAM MODE : capturer UNIQUEMENT l'avatar par OBS.
           *
           * CRITIQUE : on ne peut PAS utiliser visibility:hidden ou display:none
           * car certains modes de capture OBS (notamment BitBlt en fallback)
           * ne captent que les pixels REELLEMENT PEINTS. visibility:hidden
           * rend le contenu transparent -> capture noire.
           *
           * Approche robuste : on masque les elements indesirables avec
           * opacity:0 + pointer-events:none, et on FORCE la video ChapCam a
           * occuper EXACTEMENT toute la fenetre, avec un fond noir opaque
           * derriere. OBS capture la fenetre entiere -> il ne voit que la video.
           */

          /* Racine : fond noir, aucun padding/margin */
          .cc-stream-root {
            background: #000 !important;
            padding: 0 !important;
            margin: 0 !important;
            min-height: 100vh !important;
            overflow: hidden !important;
          }

          /* Tout element SAUF le stage et ses ancêtres est caché.
              FIX écran noir (02/2026) : l'ancien sélecteur masquait TOUT les enfants directs
              avec opacity:0, y compris le grid parent du stage -> le stage fixed héritait
              de l'opacity 0 et OBS capturait du noir. On garde les ancêtres du stage
              (.cc-keep-tree) visibles et on cache leurs frères via display:none. */
           .cc-stream-root > *:not(.cc-keep-tree):not(:has(.cc-cam-stage)) {
             display: none !important;
           }
           .cc-stream-root > .cc-keep-tree {
             display: block !important;
             opacity: 1 !important;
             position: static !important;
             width: auto !important;
             height: auto !important;
             overflow: visible !important;
             left: auto !important;
             top: auto !important;
           }
           .cc-keep-tree > *:not(.cc-keep-tree):not(.cc-cam-stage):not(:has(.cc-cam-stage)) {
             display: none !important;
           }

          /* Empecher le scroll pendant le Stream Mode */
          html, body {
            overflow: hidden !important;
            background: #000 !important;
          }

          /* Stage de la camera ChapCam : plein ecran FIXE par-dessus tout.
             Rebascule la video en haut du z-stack. */
          .cc-cam-stage.cc-stream-keep-block {
            position: fixed !important;
            inset: 0 !important;
            z-index: 9999 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #000 !important;
            aspect-ratio: unset !important;
            width: 100vw !important;
            height: 100vh !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }

          /* Video : remplir le viewport sans couper */
          .cc-cam-stage.cc-stream-keep-block video {
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
            object-position: center !important;
            display: block !important;
          }

          /* Bouton Quitter Stream : toujours visible (au survol) */
          .cc-cam-stage.cc-stream-keep-block button[title="Quitter le mode Stream"] {
            position: absolute !important;
            top: 16px !important;
            right: 16px !important;
            z-index: 10000 !important;
          }
        `}</style>
      )}
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 md:text-3xl">
            <Zap className="w-6 h-6 text-primary" />
            Live Swap
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transformez votre apparence en temps réel avec l&apos;IA.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Guide d'utilisation */}
          <Link
            href="/dashboard/mes-demandes"
            className="hidden items-center gap-2 rounded-lg border border-hairline bg-muted px-4 py-2 text-sm font-semibold text-foreground backdrop-blur-md transition-colors hover:border-hairline-strong sm:flex"
          >
            <BookOpen className="h-4 w-4" />
            Mes demandes
          </Link>

          {/* Demande d'installation (bleu) */}
          <button
            onClick={() => setShowInstallModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-colors hover:bg-[#1d4ed8]"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Demande d&apos;installation</span>
            <span className="sm:hidden">Installation</span>
          </button>

          {/* Credits restants */}
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-muted px-4 py-2 backdrop-blur-md">
            <Coins className="w-4 h-4 text-yellow-500" />
            {FREE_MODE ? (
              <>
                <span className="text-primary font-bold">Illimité</span>
                <span className="text-muted-foreground text-sm">gratuit</span>
              </>
            ) : (
              <>
                <span className="text-foreground font-bold">{userPoints.toLocaleString()}</span>
                <span className="text-muted-foreground text-sm">points</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-hairline bg-muted px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {isConnected ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-text-faint" />}
          <span className={`text-sm font-medium ${isConnected ? 'text-primary' : 'text-muted-foreground'}`}>
            {isConnected ? 'Connexion excellente' : 'Connexion prête'}
          </span>
        </div>
        <div className="hidden h-4 w-px bg-muted sm:block" />
        <div className="flex items-center gap-2 text-sm">
          {processingMode === 'local' ? <Monitor className="h-4 w-4 text-green-400" /> : <Cloud className="h-4 w-4 text-blue-400" />}
          <span className="text-muted-foreground">Mode :</span>
          <span className="font-medium text-foreground">{processingMode === 'local' ? 'Local' : 'Cloud'}</span>
        </div>
        <div className="hidden h-4 w-px bg-muted sm:block" />
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {renderQuality === 'ultra' ? '4K' : renderQuality === 'hd' ? 'HD' : 'SD'}
          </span>
          <span className="text-muted-foreground">Qualité :</span>
          <span className="font-medium text-foreground">
            {renderQuality === 'ultra' ? 'Ultra HD' : renderQuality === 'hd' ? 'HD' : 'Standard'}
          </span>
        </div>
        <div className="hidden h-4 w-px bg-muted sm:block" />
        <div className="flex items-center gap-2 text-sm">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground">Latence :</span>
          <span className="font-medium text-foreground">{stats.latency || 120} ms</span>
        </div>
        {/* Indicateur Mode Démo */}
        {demoMode && (
          <>
            <div className="hidden h-4 w-px bg-muted sm:block" />
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 px-2.5 py-1 text-[10px] font-bold uppercase text-yellow-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400"></span>
                </span>
                MODE DÉMO
              </span>
              <span className="text-xs text-yellow-300">Webcam locale seulement — Configurez DECART_API_KEY pour le vrai swap IA</span>
            </div>
          </>
        )}
        {/* Diagnostic express : etat Decart + video */}
        {isDesktop && (
          <>
            <div className="hidden h-4 w-px bg-muted sm:block" />
            <div className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : isConnecting ? 'bg-yellow-400 animate-pulse' : error ? 'bg-red-400' : 'bg-gray-500'}`} />
              <span className="text-muted-foreground">
                {isConnected
                  ? `Video ${remoteVideoDims ? `${remoteVideoDims.w}x${remoteVideoDims.h}` : '--'}`
                  : isConnecting
                    ? 'Connexion...'
                    : error
                      ? 'Erreur'
                      : 'En attente'}
              </span>
              {error && <span className="text-red-400 truncate max-w-[200px]" title={error}>{error}</span>}
            </div>
            <button
              onClick={async () => {
                try {
                  const api = (window as any).electronAPI
                  if (!api?.getDebugLog) return
                  const log = await api.getDebugLog()
                  const prefix =
                    `LIVECAM diagnostic ${new Date().toISOString()}\n` +
                    `isElectron=${isElectron()} isConnected=${isConnected} isConnecting=${isConnecting} error=${error}\n` +
                    `connectionState=${connectionState} streamMode=${streamMode} remoteDims=${remoteVideoDims ? `${remoteVideoDims.w}x${remoteVideoDims.h}` : 'none'}\n\n`
                  await navigator.clipboard.writeText(prefix + log)
                  setDebugCopied(true)
                  setTimeout(() => setDebugCopied(false), 2000)
                } catch (e) {
                  console.error('[live-swap] Copie diagnostic:', e)
                }
              }}
              className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-muted px-2.5 text-[10px] font-semibold text-foreground/70 transition-colors hover:border-hairline-strong hover:text-foreground"
              title="Copier les logs de diagnostic dans le presse-papiers"
            >
              <AlertTriangle className="h-3 w-3" />
              {debugCopied ? 'Copié !' : 'Diagnostic'}
            </button>
          </>
        )}
      </div>

      {/* Rappel : version premium / mode démo */}
      {demoMode ? (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-transparent p-4">
          <div className="rounded-lg bg-yellow-500/20 p-2">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Mode Démo Local Actif</p>
            <p className="mt-1 text-xs text-foreground/60">
              Vous voyez votre webcam locale (effet miroir). Pour le <strong>vrai swap IA temps réel</strong>,
              ajoutez votre <code className="px-1 bg-black/30 rounded text-yellow-300">DECART_API_KEY</code>
              dans <code className="px-1 bg-black/30 rounded text-yellow-300">.env.local</code> (inscription gratuite sur
              <a href="https://platform.decart.ai" target="_blank" rel="noopener" className="underline text-yellow-300 hover:text-yellow-200">platform.decart.ai</a>).
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 to-transparent p-4">
          <div className="rounded-lg bg-primary/20 p-2">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Tu utilises la vraie version LIVECAM</p>
            <p className="mt-1 text-xs text-foreground/60">
              Ici, pas de bug et la transformation se fait de la tete aux pieds, en bien meilleure qualite
              que l&apos;essai gratuit. C&apos;est le vrai logiciel.
            </p>
          </div>
        </div>
      )}

      {/* Hardware Detection Banner */}
      {hardware?.isGamingPC && (
        <div className="bg-gradient-to-r from-green-500/10 to-transparent border border-green-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Monitor className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-400">PC Gaming detecte - Traitement local disponible</p>
              <p className="text-xs text-foreground/60">{hardware.gpuName} | {hardware.vramEstimate}GB VRAM | Mode {processingMode}</p>
            </div>
          </div>
        </div>
      )}

      {/* Bannière : Caméra virtuelle = App Desktop uniquement */}
      {!isDesktop && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-500/10 to-transparent p-4">
          <div className="p-2 rounded-lg bg-blue-500/20 shrink-0 mt-0.5">
            <Monitor className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-400">Caméra virtuelle → App Desktop uniquement</p>
            <p className="mt-1 text-xs text-foreground/70">
              Le navigateur <strong>ne peut pas</strong> créer de périphérique caméra système.
              Pour que WhatsApp, Zoom, Teams, Meet voient votre avatar :
            </p>
            <ul className="mt-1.5 text-xs text-foreground/60 list-disc list-inside space-y-0.5">
              <li>Téléchargez <strong>LIVECAM Desktop</strong> (fichier <code className="px-1 bg-black/30 rounded">.exe</code>)</li>
              <li>Installez-le, puis installez <strong>OBS Studio</strong> (obsproject.com) si ce n&apos;est pas déjà fait</li>
              <li>Démarrez le Live Swap, puis lancez OBS depuis le bouton « Lancer OBS »</li>
              <li>Dans WhatsApp/Zoom/OBS : choisissez <strong>OBS Virtual Camera</strong></li>
            </ul>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <a
                href="/download"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors"
              >
                <Download className="h-3 w-3" />
                Télécharger LIVECAM Desktop
              </a>
              <a
                href="/chapcam-pc"
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/5 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Plus d&apos;infos
              </a>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
            <span className="text-red-400 break-words">{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 text-xs text-red-400/70 hover:text-red-300"
            aria-label="Fermer l'erreur"
          >
            Fermer
          </button>
        </div>
      )}
      {accessError && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="w-5 h-5 shrink-0 text-orange-500" />
            <span className="text-orange-400 break-words">{accessError}</span>
          </div>
          <button
            type="button"
            onClick={() => setAccessError(null)}
            className="shrink-0 text-xs text-orange-400/70 hover:text-orange-300"
            aria-label="Fermer l'alerte d'accès"
          >
            Fermer
          </button>
        </div>
      )}
      {/* Note : le flux est diffuse via OBS Virtual Camera (chemin principal) ou
          le pilote "ChapCam Camera" (fallback), voir VirtualCameraIndicator. */}

      {/* Main layout : contenu + panneau de reglages */}
      <div className={`grid gap-6 lg:grid-cols-[1fr_340px] ${isStreamActive ? 'cc-keep-tree' : ''}`}>
        {/* Colonne principale */}
        <div className={`space-y-6 ${isStreamActive ? 'cc-keep-tree' : ''}`}>
          {/* Cameras avec cercle IA — la camera ChapCam est volontairement plus grande
              pour faciliter la capture en fenetre dans OBS */}
          <div className={`relative grid gap-6 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] ${isStreamActive ? 'cc-keep-tree' : ''}`}>
            {/* Camera reelle */}
            <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-2 border-b border-hairline bg-muted px-4 py-2.5 backdrop-blur-md">
                <Camera className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium text-foreground">Caméra réelle</span>
                {isConnected && (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" /> EN DIRECT
                  </span>
                )}
              </div>
              <div className="relative aspect-video bg-background">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {!isConnected && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-text-faint">
                    <Camera className="mb-2 h-12 w-12 opacity-50" />
                    <p className="text-sm">Caméra inactive</p>
                  </div>
                )}
                {/* Controles camera */}
                <div className="absolute inset-x-3 bottom-3 z-20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setMicOn(v => !v)}
                      aria-label={micOn ? 'Couper le micro' : 'Activer le micro'}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-black/50 text-foreground/80 backdrop-blur-md transition-colors hover:bg-black/70"
                    >
                      {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-red-400" />}
                    </button>
                    <button
                      onClick={() => setCamOn(v => !v)}
                      aria-label={camOn ? 'Couper la caméra' : 'Activer la caméra'}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-black/50 text-foreground/80 backdrop-blur-md transition-colors hover:bg-black/70"
                    >
                      {camOn ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4 text-red-400" />}
                    </button>
                    <div className="flex h-9 items-end gap-0.5 rounded-lg border border-hairline bg-black/50 px-2 py-2 backdrop-blur-md">
                      {[0, 1, 2, 3, 4, 5].map(i => (
                        <span
                          key={i}
                          className="cc-wave-bar w-0.5 rounded-full bg-primary"
                          style={{ height: '100%', animationDelay: `${i * 0.12}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Camera ChapCam */}
            <div className="overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-[0_8px_40px_rgba(0,255,136,0.12)]">
              <div className="flex items-center gap-2 border-b border-primary/20 bg-muted px-4 py-2.5 backdrop-blur-md">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">Caméra LIVECAM</span>
                <div className="ml-auto flex items-center gap-2 text-[11px]">
                  {isConnected && (
                    <>
                      <span className="font-semibold text-primary">{stats.fps} FPS</span>
                      <span className="text-foreground/30">|</span>
                      <span className="text-foreground/60">{stats.resolution}</span>
                      <span className="text-foreground/30">|</span>
                      <span className="flex items-center gap-1 text-foreground/60">
                        <Clock className="h-3 w-3" />
                        {formatDuration(duration)}
                      </span>
                    </>
                  )}
                  <button
                    onClick={() => setMirrorOutput(m => !m)}
                    aria-label={mirrorOutput ? 'Désactiver le miroir' : 'Activer le miroir'}
                    title={mirrorOutput ? 'Miroir actif (inversé)' : 'Miroir inactif (direct)'}
                    className={`flex h-7 px-2 items-center gap-1 text-[10px] font-semibold rounded-md border transition-colors ${
                      mirrorOutput
                        ? 'border-primary/50 bg-primary/20 text-primary'
                        : 'border-hairline bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Share2 className="h-3 w-3" />
                    Miroir {mirrorOutput ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={toggleCamFullscreen}
                    aria-label={isCamFullscreen ? 'Réduire la caméra' : 'Agrandir la caméra'}
                    title={isCamFullscreen ? 'Réduire' : 'Agrandir en plein écran'}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                  >
                    {isCamFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </button>
                  {/* Bouton Stream Mode (app desktop) : masque toute l'interface
                      pour ne laisser que la sortie ChapCam, capturee par OBS. */}
                  {isDesktop && isConnected && (
                    <button
                      onClick={() => setStreamMode(m => !m)}
                      aria-label={streamMode ? 'Quitter le mode Stream' : 'Mode Stream (sortie seule)'}
                      title={streamMode ? 'Quitter le mode Stream' : 'Mode Stream : affiche uniquement la sortie LIVECAM pour OBS'}
                      className={`flex h-7 px-2 items-center gap-1 text-[10px] font-semibold rounded-md border transition-colors ${
                        streamMode
                          ? 'border-green-500/50 bg-green-500/20 text-green-400 animate-pulse'
                          : 'border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
                      }`}
                    >
                      <Tv className="h-3 w-3" />
                      {streamMode ? 'STREAM ON' : 'Stream'}
                    </button>
                  )}
                </div>
              </div>
              <div
                ref={chapCamRef}
                className={`cc-cam-stage relative aspect-video bg-background ${
                  isStreamActive ? 'cc-stream-keep-block' : ''
                }`}
              >
                <video
                  ref={remoteVideoRef}
                  data-chapcam-output="true"
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                  // En Stream Mode, JAMAIS de miroir CSS : l'interlocuteur dans
                  // WhatsApp doit voir l'avatar dans le bon sens.
                  style={{
                    transform: !isStreamActive && mirrorOutput ? 'scaleX(-1)' : 'none',
                  }}
                />

                {/* En Stream Mode, AUCUN overlay (spinner, badges, contrôles) —
                    OBS capture exactement cette fenetre, elle doit etre pure. */}
                {!isStreamActive && isConnecting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}

                {/* Bouton Quitter Stream — visible uniquement au survol pour ne
                    pas polluer la capture OBS */}
                {isStreamActive && (
                  <button
                    onClick={() => setStreamMode(false)}
                    aria-label="Quitter le mode Stream"
                    title="Quitter le mode Stream"
                    className="absolute top-4 right-4 z-[10000] flex h-9 px-3 items-center gap-2 text-[11px] font-semibold rounded-lg border border-white/15 bg-black/50 text-white/60 backdrop-blur-md transition-all opacity-0 hover:opacity-100 focus:opacity-100"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                    Quitter Stream
                  </button>
                )}
              </div>

              {/* Indicateur d'etat du flux de diffusion (cache en Stream Mode) */}
              {!isStreamActive && (
                <div className="m-3">
                  <VirtualCameraIndicator className="flex-1" />
                </div>
              )}
            </div>

          </div>

          {/* Outils rapides ChapCam - BLOQUÉS */}
          <BlockedModal />
          <div className="rounded-2xl border border-hairline bg-muted p-4 backdrop-blur-xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/50">
              Outils rapides LIVECAM
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {quickTools.map(tool => (
                <button
                  key={tool.href}
                  onClick={showBlocked}
                  className="group flex items-center gap-2.5 rounded-xl border border-hairline bg-black/30 px-3 py-2.5 text-left opacity-60 transition-all duration-200 hover:border-amber-500/30 hover:bg-amber-500/10"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${tool.color}22` }}
                  >
                    <tool.icon className="h-4 w-4" style={{ color: tool.color }} />
                  </span>
                  <span className="flex-1 truncate text-xs font-medium text-foreground">{tool.label}</span>
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                </button>
              ))}
            </div>
          </div>

          {/* Avatars */}
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            {/* Avatar selectionne */}
            <div className="rounded-2xl border border-hairline bg-muted p-4 backdrop-blur-xl">
              <p className="mb-3 text-sm font-semibold text-foreground">Avatar sélectionné</p>
              {selectedAvatar ? (
                <div className="flex items-center gap-3">
                  <Image
                    src={selectedAvatar.url || '/placeholder.svg'}
                    alt={selectedAvatar.name}
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-xl border border-primary/40 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{selectedAvatar.name}</p>
                    <p className="text-xs text-foreground/40">Actif</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground/40">Aucun avatar sélectionné</p>
              )}
            </div>

            {/* Mes avatars */}
            <div className="rounded-2xl border border-hairline bg-muted p-4 backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Mes avatars</p>
                <Link href="/dashboard/avatars" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter
                </Link>
              </div>

              {avatars.length === 0 ? (
                <div className="flex items-center gap-3 py-2">
                  <Link
                    href="/dashboard/avatars"
                    className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline-strong text-foreground/50 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Plus className="h-5 w-5" />
                  </Link>
                  <p className="text-sm text-foreground/40">Créez votre premier avatar</p>
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {avatars.map(avatar => (
                    <button
                      key={avatar.id}
                      onClick={() => handleSelectAvatar(avatar)}
                      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                        selectedAvatar?.id === avatar.id
                          ? 'border-primary shadow-[0_0_20px_rgba(0,255,136,0.3)]'
                          : 'border-hairline hover:border-white/30'
                      }`}
                    >
                      <Image src={avatar.url || '/placeholder.svg'} alt={avatar.name} fill sizes="80px" className="object-cover" />
                      {selectedAvatar?.id === avatar.id && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                          <Check className="h-3 w-3 text-black" />
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                        <span className="block truncate text-[10px] font-medium text-foreground">{avatar.name}</span>
                      </span>
                    </button>
                  ))}
                  <Link
                    href="/dashboard/avatars"
                    className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-hairline-strong text-foreground/50 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Plus className="h-5 w-5" />
                    <span className="text-[10px]">Ajouter</span>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Certification d'usage responsable (avant demarrage) */}
          {!isConnected && (
            <SwapConsent checked={swapConsent} onChange={setSwapConsent} className="mb-3" />
          )}

          {/* Bouton Demarrer (degrade vert -> violet).
              Pendant isConnecting on laisse cliquer pour ANNULER (disconnect). */}
          <button
            onClick={
              isConnected || isConnecting
                ? handleStopSwap
                : () => void handleStartSwap()
            }
            disabled={!isConnected && !isConnecting && !canStart}
            className={`group relative w-full overflow-hidden rounded-2xl py-5 text-lg font-bold transition-all ${
              isConnected
                ? 'bg-red-500 text-white hover:bg-red-600'
                : isConnecting
                ? 'cursor-pointer bg-yellow-500 text-black hover:bg-yellow-400'
                : canStart
                ? 'bg-gradient-to-r from-primary via-[#1ec8d8] to-[#8b5cf6] text-foreground shadow-[0_0_40px_rgba(0,255,136,0.35)] hover:shadow-[0_0_60px_rgba(139,92,246,0.45)]'
                : 'cursor-not-allowed bg-gray-700 text-muted-foreground'
            }`}
          >
            <span className="flex flex-col items-center justify-center gap-0.5">
              {isConnecting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Connexion en cours… (cliquer pour annuler)
                </span>
              ) : isConnected ? (
                <span className="flex items-center gap-2">
                  <Square className="h-5 w-5" />
                  Arrêter le Live Swap
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    Démarrer le Live Swap
                  </span>
                  <span className="text-xs font-normal opacity-80">
                    La transformation commencera en temps réel
                  </span>
                </>
              )}
            </span>
          </button>

          {!isConnected && <GenerateNotice className="mt-3" />}
        </div>

        {/* Panneau de reglages */}
        <aside className="h-fit space-y-6 rounded-2xl border border-hairline bg-muted p-5 backdrop-blur-xl lg:sticky lg:top-6">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">Réglages du swap</h2>
          </div>

          {/* Qualite de rendu */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground/60">Qualité de rendu</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/40 p-1">
              {([
                { id: 'standard', label: 'Standard' },
                { id: 'hd', label: 'HD' },
                { id: 'ultra', label: 'Ultra HD' },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setRenderQuality(opt.id)}
                  className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                    renderQuality === opt.id ? 'bg-primary text-black' : 'text-foreground/60 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          {([
            { label: 'Stabilité', value: stability, set: setStability },
            { label: 'Lissage', value: smoothing, set: setSmoothing },
            { label: 'Réduction du bruit', value: noiseReduction, set: setNoiseReduction },
          ]).map(s => (
            <div key={s.label}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/60">{s.label}</span>
                <span className="text-xs font-semibold text-primary">{s.value}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={s.value}
                onChange={e => s.set(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              />
            </div>
          ))}

          {/* Orientation du visage */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground/60">Orientation du visage</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'left', label: 'Gauche' },
                { id: 'center', label: 'Centre' },
                { id: 'right', label: 'Droite' },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setFaceOrientation(opt.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[10px] transition-colors ${
                    faceOrientation === opt.id
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-hairline bg-black/30 text-foreground/50 hover:border-hairline-strong'
                  }`}
                >
                  <Camera className="h-4 w-4" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Correction des couleurs */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/60">Correction des couleurs</span>
            <button
              onClick={() => setColorCorrection(v => !v)}
              role="switch"
              aria-checked={colorCorrection}
              aria-label="Correction des couleurs"
              className={`relative h-6 w-11 rounded-full transition-colors ${
                colorCorrection ? 'bg-primary' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  colorCorrection ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Mode de traitement */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground/60">Mode de traitement</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleModeChange('cloud')}
                disabled={hardware?.isGamingPC}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  processingMode === 'cloud'
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                    : 'border-hairline bg-black/30 text-foreground/50 hover:border-hairline-strong'
                }`}
              >
                <Cloud className="h-4 w-4" />
                Cloud
              </button>
              <button
                onClick={() => handleModeChange('local')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors ${
                  processingMode === 'local'
                    ? 'border-green-500/50 bg-green-500/10 text-green-400'
                    : 'border-hairline bg-black/30 text-foreground/50 hover:border-hairline-strong'
                }`}
              >
                <Monitor className="h-4 w-4" />
                Local
              </button>
            </div>
            {hardware?.isGamingPC && (
              <p className="mt-2 text-[10px] text-green-400/70">
                PC Gaming détecté — mode local forcé pour des performances optimales.
              </p>
            )}
          </div>

          {/* Session info */}
          <div className="space-y-2 rounded-xl border border-hairline bg-black/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-foreground/50">Durée session</span>
              <span className="font-medium text-foreground">{formatDuration(duration)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground/50">Points utilisés</span>
              <span className="font-medium text-foreground">{pointsUsed} pts</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Indicateur d'etat du flux de diffusion — repositionne hors du wrapper
          "contents" pour rester visible quand on quitte le Stream Mode. */}
      <InstallationRequestModal
        open={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />
    </div>
  )
}
