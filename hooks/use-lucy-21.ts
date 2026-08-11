'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createDecartClient, models } from '@decartai/sdk'
import { isFreeLiveSwap } from '@/lib/free-mode'
import { isElectron, getElectronAPI } from '@/lib/electron'
import { LUCY_SWAP_PROMPT, LUCY_SWAP_ENHANCE } from '@/lib/lucy-prompts'
import { prepareAvatarImage } from '@/lib/avatar-image'

// 2 points = 1 seconde de swap
const POINTS_PER_SECOND = 2
// Intervalle d'envoi de la deduction au serveur (en secondes).
// Plus court = arret plus precis a l'epuisement, moins de points "perdus".
const DEDUCTION_INTERVAL = 5

// Delai max avant d'abandonner une connexion sans 1ere image transformee.
const CONNECT_TIMEOUT_MS = 20_000

// Auto-retry borne quand Decart est temporairement en surcapacite
// ("no available runner"). Le SDK retente deja 5x en interne ; ces retries
// supplementaires relancent un cycle complet si le runner n'est toujours pas
// disponible, puis on affiche une erreur claire au lieu de laisser tomber.
const MAX_AUTO_RETRY = 3
const RETRY_DELAY_MS = [5_000, 10_000, 15_000]

// NOTE: Mode demo retiré - toujours utiliser le vrai swap IA avec Decart

// Mesure la luminance max d'une frame video (sous-echantillon 16x16).
// Utilisee pour detecter un flux renvoye par Decart qui serait noir
// (serveur qui ne genere rien -> on ne facture JAMAIS un ecran noir).
function frameMaxLuma(video: HTMLVideoElement, w: number, h: number): number {
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return -1
    ctx.drawImage(video, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let mx = 0
    for (let i = 0; i < data.length; i += 16) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (y > mx) mx = y
    }
    return mx
  } catch (_) {
    return -1
  }
}

// Lit quelques frames du flux transforme et renvoie true si elles sont
// (quasi) noires — signe que le serveur ne produit rien d'exploitable.
function isStreamBlack(stream: MediaStream, frames = 4): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (black: boolean) => {
      if (settled) return
      settled = true
      resolve(black)
    }
    try {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      let checked = 0
      let minMax = 255
      const checkFrame = () => {
        const w = Math.min(video.videoWidth || 160, 160)
        const h = Math.min(video.videoHeight || 90, 90)
        const mx = frameMaxLuma(video, w, h)
        if (mx >= 0 && mx < minMax) minMax = mx
        checked++
        if (checked >= frames) {
          try { video.srcObject = null } catch {}
          video.remove()
          done(minMax < 40) // < 40 : image quasi noire
        } else {
          setTimeout(checkFrame, 200)
        }
      }
      video.onloadedmetadata = () => video.play().catch(() => {})
      video.onplaying = checkFrame
      video.onloadeddata = checkFrame
      setTimeout(() => {
        try { video.srcObject = null } catch {}
        video.remove()
        done(checked < frames ? true : minMax < 40)
      }, 4000)
    } catch (_) {
      done(true)
    }
  })
}

export function useLucy21() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [virtualCamError, setVirtualCamError] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const realtimeClientRef = useRef<any>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // La capture pour la camera virtuelle est faite par preload.js
  // (tag [data-chapcam-output] sur remoteVideo). On ne garde ici que l'etat
  // "pilote demarre" pour ne pas double-capturer avec un canvas mort.
  const virtualCamActiveRef = useRef(false)
  // Ref vers startVirtualCamera (declaree plus bas) : permet a onRemoteStream
  // de demarrer la camera interne sans probleme d'ordre de declaration.
  const startVirtualCameraRef = useRef<((opts?: { force?: boolean }) => Promise<void>) | null>(null)
  // Chemin de diffusion : OBS Virtual Camera en priorite, pilote en fallback.
  // Le mode effectif est expose par le statut de la camera virtuelle.
  // Garde-fou : la session n'est consideree "active" (et donc facturee cote
  // page) qu'a la 1ere vraie image transformee recue, JAMAIS pendant la chauffe
  // du modele (ecran noir). Evite de debiter le client pour rien.
  const firstFrameRef = useRef(false)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Generation counter : invalide les connexions en vol apres disconnect /
  // nouvelle tentative (evite de marquer "connected" une session abandonnee).
  const connectGenRef = useRef(0)
  const mountedRef = useRef(true)
  // Compteur de retries automatiques (capacite Decart), remis a zero a la
  // 1ere frame (markLive) et au disconnect manuel.
  const autoRetryRef = useRef(0)
  // Timer du retry planifie (permet de l'annuler si l'utilisateur decoince).
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref vers connect : permet au catch de relancer une tentative complete
  // sans casser les deps du useCallback (evite une boucle de recreation).
  const connectRef = useRef<
    ((url: string, opts?: { isRetry?: boolean }) => Promise<void>) | null
  >(null)

  // ---------------------------------------------------------------------------
  // Helpers camera virtuelle (Electron)
  // ---------------------------------------------------------------------------

  const stopVirtualCamInternal = useCallback(async () => {
    // Hors Electron : aucun pilote de camera virtuelle a arreter.
    if (!isElectron()) {
      virtualCamActiveRef.current = false
      return
    }
    const api = getElectronAPI()
    if (!api?.virtualCamera?.stop) {
      virtualCamActiveRef.current = false
      return
    }

    try {
      await api.virtualCamera.stop()
    } catch (e) {
      console.error('[Lucy 2.1] Erreur arrêt caméra virtuelle :', e)
    } finally {
      virtualCamActiveRef.current = false
    }
  }, [])

  // Nettoyage media (camera + videos) sans toucher a l'etat React.
  // Utilise par disconnect et par le catch de connect.
  const releaseMedia = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop())
      } catch (e) {
        console.warn('[Lucy 2.1] Erreur stop tracks stream:', e)
      }
      streamRef.current = null
    }

    const localStream = localVideoRef.current?.srcObject as MediaStream | null
    if (localStream) {
      try {
        localStream.getTracks().forEach((track) => track.stop())
      } catch {}
    }
    const remoteStream = remoteVideoRef.current?.srcObject as MediaStream | null
    if (remoteStream) {
      try {
        remoteStream.getTracks().forEach((track) => track.stop())
      } catch {}
    }

    if (localVideoRef.current) {
      try {
        localVideoRef.current.pause()
      } catch {}
      localVideoRef.current.srcObject = null
    }
    if (remoteVideoRef.current) {
      try {
        remoteVideoRef.current.pause()
      } catch {}
      remoteVideoRef.current.srcObject = null
    }
  }, [])

  const disconnectDecart = useCallback(() => {
    if (!realtimeClientRef.current) return
    try {
      realtimeClientRef.current.disconnect()
    } catch (e) {
      console.error('[Lucy 2.1] Erreur disconnect Decart:', e)
    }
    realtimeClientRef.current = null
  }, [])

  const disconnect = useCallback(() => {
    // Invalide toute connexion en cours (markLive / timeout / onRemoteStream).
    connectGenRef.current += 1
    autoRetryRef.current = 0

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    firstFrameRef.current = false

    // 1. Fermer la session Decart (arrete la facturation cote serveur)
    disconnectDecart()

    // 2-4. Couper camera + detacher videos
    releaseMedia()

    // 5. Arreter la camera virtuelle (Electron) — fire-and-forget, pas de
    //    deadlock si le IPC est lent. L'etat local est mis a jour tout de suite.
    const wasVirtual = virtualCamActiveRef.current
    virtualCamActiveRef.current = false
    if (wasVirtual || isElectron()) {
      stopVirtualCamInternal().catch(() => {})
    }

    if (!mountedRef.current) return

    setIsConnected(false)
    setIsConnecting(false)
    setConnectionState('disconnected')
    setError(null)
    setDemoMode(false)
    setAccessChecked(false)
    setVirtualCamError(null)
  }, [disconnectDecart, releaseMedia, stopVirtualCamInternal])

  // Cleanup au demontage uniquement.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, [])

  // ---------------------------------------------------------------------------
  // Access check
  // ---------------------------------------------------------------------------

  const checkAccess = useCallback(async (): Promise<{
    canStart: boolean
    mode: string
    secondsRemaining: number
    windowExpiresAt: string | null
    gpuConfigured: boolean
    pool: string
    error?: string
  }> => {
    try {
      const res = await fetch('/api/live/access')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        return {
          canStart: false,
          mode: 'none',
          secondsRemaining: 0,
          windowExpiresAt: null,
          gpuConfigured: false,
          pool: 'default',
          error: data?.error || 'Accès refusé',
        }
      }
      return data
    } catch (err: unknown) {
      console.error('[Lucy 2.1] Access check failed:', err)
      return {
        canStart: false,
        mode: 'none',
        secondsRemaining: 0,
        windowExpiresAt: null,
        gpuConfigured: false,
        pool: 'default',
        error: "Impossible de vérifier l'accès",
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  const connect = useCallback(async (avatarImageUrl: string, opts?: { isRetry?: boolean }) => {
    if (!avatarImageUrl) {
      setError("Aucun avatar sélectionné.")
      setConnectionState('error')
      return
    }

    // Nouvelle generation : annule toute connexion precedente encore en vol.
    const gen = ++connectGenRef.current

    // Reset d'etat pour une tentative propre.
    setError(null)
    setVirtualCamError(null)
    setIsConnecting(true)
    setIsConnected(false)
    setConnectionState('connecting')
    firstFrameRef.current = false
    // Budget de retries frais uniquement pour une tentative utilisateur ;
    // une tentative interne (retry auto) conserve le compteur en cours.
    if (!opts?.isRetry) autoRetryRef.current = 0
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    // Si une session etait deja ouverte, la fermer avant d'en ouvrir une autre.
    disconnectDecart()
    releaseMedia()
    if (virtualCamActiveRef.current) {
      await stopVirtualCamInternal().catch(() => {})
    }

    const isStale = () => gen !== connectGenRef.current || !mountedRef.current

    try {
      // Check access first
      if (!accessChecked) {
        const access = await checkAccess()
        if (isStale()) return
        if (!access.canStart) {
          setError(access.error || 'Accès au Live Swap refusé')
          setIsConnecting(false)
          setConnectionState('error')
          return
        }
        setAccessChecked(true)
      }

      // Verifier les points disponibles avant de commencer (sauf mode gratuit).
      // Il suffit d'avoir au moins 1 palier de points (5s) pour demarrer ;
      // le client pourra ensuite swaper jusqu'a epuisement total du solde.
      if (!isFreeLiveSwap()) {
        const pointsRes = await fetch('/api/points')
        if (isStale()) return
        const pointsData = await pointsRes.json().catch(() => null)

        const minToStart = POINTS_PER_SECOND * DEDUCTION_INTERVAL // 10 points = 5s
        if (!pointsData?.success || (pointsData?.points ?? 0) < minToStart) {
          throw new Error('Points insuffisants. Recharge ton compte pour utiliser le swap.')
        }
      }

      const tokenRes = await fetch('/api/decart-token')
      if (isStale()) return
      const tokenData = await tokenRes.json().catch(() => null)
      const clientToken = tokenData?.token

      if (!tokenRes.ok || !clientToken) {
        const errorMsg =
          tokenData?.error ||
          tokenData?.details ||
          'Clé API Decart non configurée. Ajoutez DECART_API_KEY dans .env.local'
        throw new Error(errorMsg)
      }

      // MODE PRODUCTION : vrai token Decart
      // Selection de la caméra PHYSIQUE réelle. Sans deviceId, le navigateur /
      // Electron prend le device par defaut (souvent index 0) : si une camera
      // virtuelle (OBS Virtual Camera, ChapCam Camera...) est installee et
      // ETEINTE, elle produit un flux NOIR -> le serveur Decart ne recoit rien
      // d'exploitable -> ecran noir de sortie. On enumere les devices et on
      // ecarte les cameras virtuelles pour choisir la webcam physique.
      let stream: MediaStream
      try {
        let deviceId: string | undefined
        try {
          // Un 1er getUserMedia discret debloque les labels des devices.
          const probe = await navigator.mediaDevices.getUserMedia({ video: true })
          probe.getTracks().forEach((t) => t.stop())
          const devices = await navigator.mediaDevices.enumerateDevices()
          const real = devices.filter(
            (d) =>
              d.kind === 'videoinput' &&
              !/virtual|obs|chapcam|ndi|screen|desktop|capture/i.test(d.label || ''),
          )
          // Priorite : deviceId explicite (reglage utilisateur) sinon 1ere webcam physique.
          const savedDeviceId = localStorage.getItem('chapcam_camera_device_id')
          if (savedDeviceId && real.some((d) => d.deviceId === savedDeviceId)) {
            deviceId = savedDeviceId
          } else if (real.length > 0) {
            deviceId = real[0].deviceId
          }
          console.log(
            deviceId
              ? `[Lucy 2.1] Camera choisie: physique (deviceId ${deviceId})`
              : '[Lucy 2.1] Camera choisie: defaut (aucune webcam physique trouvée)',
          )
        } catch (_) {
          // Pas de permission / enumerateDevices indisponible : fallback defaut.
          console.warn('[Lucy 2.1] Enumeration devices impossible, camera par defaut')
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { ideal: deviceId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        })
      } catch (camError: unknown) {
        const err = camError as { name?: string; message?: string }
        if (err.name === 'NotAllowedError') {
          throw new Error(
            "Accès caméra refusé. Autorise ChapCam à accéder à ta caméra dans les paramètres du navigateur.",
          )
        } else if (err.name === 'NotFoundError') {
          throw new Error('Aucune caméra détectée. Connecte une webcam et réessaie.')
        } else if (err.name === 'NotReadableError') {
          throw new Error(
            'Caméra déjà utilisée par une autre application. Ferme les autres apps utilisant la caméra.',
          )
        } else if (err.name === 'OverconstrainedError') {
          throw new Error("Format vidéo non supporté par la webcam. Réessaie avec une autre caméra.")
        } else {
          throw new Error('Impossible de démarrer la caméra: ' + (err.message || 'erreur inconnue'))
        }
      }

      if (isStale()) {
        // Connexion annulee pendant getUserMedia : liberer immediatement.
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      streamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play().catch(() => {})

        // Attendre brièvement que la vidéo initialise ses dimensions (évite "could not determine track dimensions")
        if (localVideoRef.current.videoWidth === 0) {
          await new Promise<void>((resolve) => {
            const el = localVideoRef.current
            if (!el) {
              resolve()
              return
            }
            const onMeta = () => {
              el.removeEventListener('loadedmetadata', onMeta)
              resolve()
            }
            el.addEventListener('loadedmetadata', onMeta)
            setTimeout(() => {
              el.removeEventListener('loadedmetadata', onMeta)
              resolve()
            }, 800)
          })
        }
      }

      if (isStale()) {
        releaseMedia()
        return
      }

      let avatarBlob: Blob
      try {
        const avatarRes = await fetch(avatarImageUrl)
        if (isStale()) {
          releaseMedia()
          return
        }
        if (!avatarRes.ok) {
          throw new Error(`HTTP ${avatarRes.status}`)
        }
        avatarBlob = await avatarRes.blob()
      } catch (fetchErr: unknown) {
        const msg = fetchErr instanceof Error ? fetchErr.message : 'Erreur chargement'
        throw new Error(`Impossible de charger l'image d'avatar (${msg}). Réessaie avec un autre avatar.`)
      }

      if (avatarBlob.size === 0) {
        throw new Error("L'image d'avatar est vide. Sélectionne un autre avatar.")
      }

      // Redimensionner + compresser l'avatar avant envoi au SDK : un gros
      // avatar (jusqu'à 15 Mo) en base64 dépasserait la limite du WebSocket de
      // signalisation, le serveur rejetterait le set_image SILENCIEUSEMENT et
      // le modèle renverrait un flux noir sans image de référence.
      avatarBlob = await prepareAvatarImage(avatarBlob)

      const client = createDecartClient({ apiKey: clientToken })

      // Marque la session reellement active : appele UNIQUEMENT a la 1ere vraie
      // image transformee. C'est ce qui declenche la facturation cote page
      // (l'effet de facturation est cale sur isConnected). Tant qu'on est en
      // chauffe (ecran noir), on reste "isConnecting" => aucun debit.
      const markLive = () => {
        if (isStale() || firstFrameRef.current) return
        firstFrameRef.current = true
        autoRetryRef.current = 0
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        setIsConnected(true)
        setIsConnecting(false)
        setConnectionState('connected')
      }

      // La camera virtuelle demarre automatiquement dans onRemoteStream des la
      // 1ere image transformee. Chemin PRINCIPAL : OBS Virtual Camera (OBS
      // capture la fenetre ChapCam) ; fallback : pilote akvirtualcamera.

      const realtimeClient = await client.realtime.connect(stream, {
        model: models.realtime('lucy-2.5'),
        // IMPORTANT : on DESACTIVE le miroir interne du SDK.
        // Avec `mirror: 'auto'`, le SDK enveloppe la camera dans un pipeline
        // MediaStreamTrackProcessor dont le dispose n'annule pas le flux de
        // lecture : la camera reste alors ALLUMEE apres l'arret du swap
        // (voyant actif) jusqu'au rechargement de la page. En publiant
        // directement le flux camera brut, `disconnect()` (qui coupe les
        // tracks) eteint reellement la camera. L'effet miroir "selfie" est
        // reproduit en pur CSS (scaleX(-1)) sur les deux videos de la page.
        mirror: false,
        resolution: '720p',

        // CRITIQUE Electron : le SDK publie la camera en H.264 par defaut
        // (REALTIME_CONFIG.livekit.defaultVideoCodec). Le Chromium embarqué
        // d'Electron n'a pas d'encodeur H.264 fiable -> le flux publié est
        // noir. On force VP8, supporté partout, dans l'app de bureau.
        preferredVideoCodec: isElectron() ? 'vp8' : undefined,

        // Même combat côté RECEPTION : le SDK n'envoie `livekit_server_codec`
        // que pour Safari (prepare-connection.js). Sans ce hint, le serveur
        // Decart choisit H.264 pour le flux transformé renvoyé, que le
        // Chromium embarqué décode mal -> écran noir. On force VP8 aussi en
        // réception dans l'app de bureau (exactement comme le SDK le fait
        // pour Safari Desktop).
        queryParams: isElectron() ? { livekit_server_codec: 'vp8' } : undefined,

        // IMPORTANT : on passe l'avatar (image + prompt) via `initialState`.
        // Ainsi le SDK applique l'etat initial pendant le handshake de
        // connexion, une fois la WebSocket de signalisation reellement ouverte.
        // Appeler `set()` juste apres `connect()` provoquait l'erreur
        // "WebSocket is not open" (l'etat LiveKit est "connected" mais la
        // WebSocket de signalisation ne l'est pas encore).
        initialState: {
          image: avatarBlob,
          prompt: {
            text: LUCY_SWAP_PROMPT,
            enhance: LUCY_SWAP_ENHANCE,
          },
        },

        // Affichage direct du flux transforme renvoye par Decart, sans aucun
        // traitement intermediaire. Le badge natif "AI Generated" de Decart
        // reste visible, c'est normal et attendu.
        onRemoteStream: (transformedStream: MediaStream) => {
          if (isStale()) {
            // Session abandonnee : ne pas attacher le flux (evite camera
            // fantome) et laisser le client se fermer via disconnect.
            try {
              transformedStream.getTracks().forEach((t) => t.stop())
            } catch {}
            return
          }

          const el = remoteVideoRef.current
          if (!el) return
          el.srcObject = transformedStream
          // Forcer la lecture (corrige l'ecran noir si l'autoplay ne demarre pas).
          el.play().catch(() => {})

          // Detecter la 1ere image reellement peinte avant de facturer.
          const elAny = el as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number
          }
          const tryMarkLive = () => {
            if (isStale() || firstFrameRef.current) return
            // Garde-fou anti ecran noir : on ne facture que si le flux
            // transforme contient de VRAIS pixels (luma > 40/255). Un flux
            // noir signifie que le serveur ne genere rien (image ref rejetee,
            // codec illisible...) -> on retente au lieu de debiter le client.
            isStreamBlack(transformedStream)
              .then((black) => {
                if (isStale() || firstFrameRef.current) return
                if (!black) {
                  markLive()
                  return
                }
                console.warn(
                  '[Lucy 2.1] Flux transforme NOIR detecte (serveur ne renvoie rien) — retry',
                )
                // Fermer la session noire et relancer une tentative complete.
                if (connectTimeoutRef.current) {
                  clearTimeout(connectTimeoutRef.current)
                  connectTimeoutRef.current = null
                }
                disconnectDecart()
                releaseMedia()
                if (virtualCamActiveRef.current) {
                  stopVirtualCamInternal().catch(() => {})
                }
                if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
                setConnectionState('connecting')
                setIsConnecting(true)
                setIsConnected(false)
                setError(
                  'Le flux transformé est arrivé vide (écran noir). Nouvelle tentative…',
                )
                retryTimerRef.current = setTimeout(() => {
                  retryTimerRef.current = null
                  if (!mountedRef.current) return
                  connectRef.current?.(avatarImageUrl, { isRetry: true })
                }, 4000)
              })
              .catch(() => markLive())
          }
          if (typeof elAny.requestVideoFrameCallback === 'function') {
            elAny.requestVideoFrameCallback(() => tryMarkLive())
          } else {
            el.onplaying = () => tryMarkLive()
          }

          // Auto-demarrage de la camera virtuelle. Chemin PRINCIPAL : OBS
          // Virtual Camera (OBS est lance avec --startvirtualcam et capture la
          // fenetre ChapCam). Fallback : pilote akvirtualcamera embarque.
          startVirtualCameraRef.current?.({ force: true }).catch(() => {})
        },
      })

      if (isStale()) {
        try {
          realtimeClient.disconnect()
        } catch {}
        releaseMedia()
        return
      }

      realtimeClientRef.current = realtimeClient

      // Gestionnaire de fin inattendue du flux camera physique (deconnexion materielle)
      const cameraTrack = stream.getVideoTracks()[0]
      if (cameraTrack) {
        cameraTrack.onended = () => {
          if (isStale()) return
          console.warn('[Lucy 2.1] La caméra physique a été déconnectée')
          disconnect()
          setError('La caméra physique a été déconnectée.')
          setConnectionState('error')
        }
      }

      // Écouteur d'erreurs du SDK Decart
      try {
        realtimeClient.on?.('error', (err: any) => {
          if (isStale()) return
          console.error('[Lucy 2.1] Erreur client IA:', err)
          // Le SDK classe la plupart des echecs en "Signaling error" (fallback
          // du classifieur) et met la VRAIE cause dans err.cause. On la remonte
          // pour afficher le message reel du serveur (ex: rejet du set_image_ack,
          // permission denied, image trop grosse...).
          const cause =
            typeof err?.cause === 'string'
              ? err.cause
              : err?.cause instanceof Error
                ? err.cause.message
                : undefined
          const baseMessage =
            typeof err === 'string'
              ? err
              : err?.message || 'Interruption du service IA'
          const message = cause && cause !== baseMessage ? `${baseMessage} (${cause})` : baseMessage
          console.error('[Lucy 2.1] Cause réelle:', err?.cause)
          disconnect()
          setError(`Erreur service IA : ${message}`)
          setConnectionState('error')
        })
      } catch {}

      // Suivi de l'etat de connexion Decart/LiveKit
      realtimeClient.on?.('connectionChange', (state: string) => {
        if (isStale()) return
        setConnectionState(state)
        console.log(`[Lucy 2.1] ConnectionState: ${state} (firstFrame=${firstFrameRef.current})`)
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          if (firstFrameRef.current) {
            disconnect()
            setError('La connexion avec le service IA a été interrompue.')
            setConnectionState('error')
          }
        }
      })

      // Diagnostics : position en file d'attente Decart (modele charge) et
      // progression de generation. Logs utiles pour confirmer que le modele
      // tourne pendant l'ecran noir.
      realtimeClient.on?.('queuePosition', (qp: { position: number; queueSize: number }) => {
        if (isStale()) return
        console.log(`[Lucy 2.1] File Decart: position ${qp.position}/${qp.queueSize}`)
      })
      realtimeClient.on?.('generationTick', (e: { seconds: number }) => {
        if (isStale()) return
        console.log(`[Lucy 2.1] generation_tick: ${e.seconds}s`)
      })
      realtimeClient.on?.('connectionQuality', (r: unknown) => {
        if (isStale()) return
        console.log('[Lucy 2.1] connectionQuality:', r)
      })

      // Garde-fou : si aucune image transformee n'arrive en 20s, on coupe et on
      // previent l'utilisateur, sans jamais l'avoir facture pour l'ecran noir.
      connectTimeoutRef.current = setTimeout(() => {
        if (isStale() || firstFrameRef.current) return
        // Saturation / chauffe lente du modele : on retente (borne) avant
        // d'abandonner. La facturation n'a pas commence (firstFrameRef false).
        if (autoRetryRef.current < MAX_AUTO_RETRY) {
          autoRetryRef.current += 1
          const delay = RETRY_DELAY_MS[autoRetryRef.current - 1]
          disconnectDecart()
          releaseMedia()
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          setConnectionState('connecting')
          setIsConnecting(true)
          setIsConnected(false)
          setError(
            `La transformation n'a pas démarré. Nouvelle tentative ${autoRetryRef.current}/${MAX_AUTO_RETRY} dans ${Math.round(delay / 1000)} s…`,
          )
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null
            if (!mountedRef.current) return
            connectRef.current?.(avatarImageUrl, { isRetry: true })
          }, delay)
          return
        }
        // disconnect() d'abord (cleanup media + invalide gen), PUIS on pose
        // l'erreur : disconnect remet error a null, donc l'ordre compte.
        disconnect()
        setError("La transformation n'a pas démarré. Réessaie dans un instant.")
        setConnectionState('error')
        setIsConnecting(false)
        setIsConnected(false)
      }, CONNECT_TIMEOUT_MS)
    } catch (err: unknown) {
      if (isStale()) return
      console.error('[Lucy 2.1]', err)

      // Nettoyage complet : couper la camera et fermer toute session Decart
      // ouverte avant l'echec, pour ne pas laisser la camera allumee ni
      // facturer Decart inutilement.
      disconnectDecart()
      releaseMedia()
      if (virtualCamActiveRef.current) {
        stopVirtualCamInternal().catch(() => {})
      }
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      firstFrameRef.current = false

      const rawMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
      const isCapacityError =
        /no available runner|model instance|please retry|decart unavailable|capacity/i.test(
          rawMessage,
        ) ||
        (err instanceof Error && /decart unavailable/i.test(err.message))

      // Saturation serveur Decart (intermittente) : on retente automatiquement
      // (borne) avant de laisser tomber. La facturation ne demarre qu'a la 1ere
      // frame (markLive), donc aucun risque de facturation pendant les retries.
      if (isCapacityError && autoRetryRef.current < MAX_AUTO_RETRY) {
        autoRetryRef.current += 1
        const delay = RETRY_DELAY_MS[autoRetryRef.current - 1]
        setConnectionState('connecting')
        setIsConnecting(true)
        setIsConnected(false)
        setError(
          `Le service IA Decart est temporairement saturé (aucun serveur de calcul disponible). Nouvelle tentative ${autoRetryRef.current}/${MAX_AUTO_RETRY} dans ${Math.round(delay / 1000)} s…`,
        )
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          if (!mountedRef.current) return
          connectRef.current?.(avatarImageUrl, { isRetry: true })
        }, delay)
        return
      }

      let message = rawMessage
      if (isCapacityError) {
        message =
          "Le service IA Decart est temporairement saturé (aucun serveur de calcul disponible pour lucy-2.5). Réessaie dans quelques minutes."
      } else if (
        /signaling|server error|websocket|connect/i.test(rawMessage) ||
        /signaling/i.test(String(err))
      ) {
        message =
          "Erreur de connexion au serveur IA Decart (signaling server error). Vérifiez que votre clé DECART_API_KEY dans .env.local est une clé valide générée sur platform.decart.ai et que votre connexion internet est stable."
      }
      setIsConnected(false)
      setConnectionState('error')
      setError(message)
      setIsConnecting(false)
      setAccessChecked(false)
    }
  }, [
    accessChecked,
    checkAccess,
    disconnect,
    disconnectDecart,
    releaseMedia,
    stopVirtualCamInternal,
  ])

  // Expose connect via ref pour que le catch puisse relancer une tentative
  // complete sans figer connect dans ses propres deps.
  connectRef.current = connect

  // ---------------------------------------------------------------------------
  // Camera virtuelle manuelle
  // ---------------------------------------------------------------------------

  const startVirtualCamera = useCallback(async (opts?: { force?: boolean }) => {
    if (!isElectron()) return
    const api = getElectronAPI()
    if (!api?.virtualCamera?.start) return
    // Si on n’est pas connecte et qu’on ne force pas, on refuse (evite de
    // demarrer la vcam sans flux transforme). L’appel interne depuis
    // onRemoteStream passe force=true.
    if (!isConnected && !opts?.force) {
      setVirtualCamError("Démarre le Live Swap avant d'activer la caméra virtuelle.")
      return
    }

    // Arrêter toute caméra virtuelle existante avant d'en redémarrer une
    if (virtualCamActiveRef.current) {
      try {
        await api.virtualCamera.stop()
      } catch {}
      virtualCamActiveRef.current = false
    }

    try {
      // Le preload demarre la capture des pixels de [data-chapcam-output]
      // des que virtualCamera.start reussit (et le main envoie aussi vcam:start).
      const state = await api.virtualCamera.start({ width: 1280, height: 720, fps: 30 })
      virtualCamActiveRef.current = !!state?.running
      if (state?.error) {
        setVirtualCamError(state.error)
      } else if (!state?.running) {
        setVirtualCamError(
          state?.driverInstalled === false && !state?.obsAvailable
            ? 'Aucune caméra virtuelle disponible. Installe OBS Studio (obsproject.com) pour diffuser.'
            : 'La caméra virtuelle n’a pas démarré.',
        )
      } else {
        setVirtualCamError(null)
        console.log(
          `[Lucy 2.1] Caméra virtuelle démarrée (mode ${state?.mode || 'driver'})`,
        )
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Lucy 2.1] Erreur démarrage caméra virtuelle :', e)
      virtualCamActiveRef.current = false
      setVirtualCamError(msg || 'Erreur démarrage caméra virtuelle')
    }
  }, [isConnected])

  startVirtualCameraRef.current = startVirtualCamera

  const stopVirtualCamera = useCallback(async () => {
    await stopVirtualCamInternal()
    setVirtualCamError(null)
    console.log('[Lucy 2.1] Caméra virtuelle arrêtée')
  }, [stopVirtualCamInternal])

  // Changer d'avatar a chaud, sans couper la session Decart en cours.
  const updateAvatar = useCallback(async (avatarImageUrl: string) => {
    if (!realtimeClientRef.current) return

    try {
      const avatarRes = await fetch(avatarImageUrl)
      if (!avatarRes.ok) {
        throw new Error(`Chargement avatar échoué (${avatarRes.status})`)
      }
      const avatarBlob = await avatarRes.blob()
      if (avatarBlob.size === 0) {
        throw new Error("Image d'avatar vide")
      }
      const prepared = await prepareAvatarImage(avatarBlob)
      await realtimeClientRef.current.set({
        image: prepared,
        prompt: LUCY_SWAP_PROMPT,
        enhance: LUCY_SWAP_ENHANCE,
      })
    } catch (err) {
      console.error('[Lucy 2.1] Erreur changement avatar:', err)
      setError(
        err instanceof Error
          ? `Impossible de changer d'avatar : ${err.message}`
          : "Impossible de changer d'avatar.",
      )
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return {
    isConnected,
    isConnecting,
    connectionState,
    error,
    clearError,
    demoMode,
    virtualCamError,
    localVideoRef,
    remoteVideoRef,
    connect,
    disconnect,
    updateAvatar,
    startVirtualCamera,
    stopVirtualCamera,
    checkAccess,
  }
}
