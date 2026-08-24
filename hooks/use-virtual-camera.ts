'use client'

import { useEffect, useState, useCallback } from 'react'
import { getElectronAPI, isElectron, type VirtualCameraState } from '@/lib/electron'

const DEFAULT_STATE: VirtualCameraState = {
  running: false,
  deviceName: 'ChapCam Camera',
  driverInstalled: false,
  error: null,
  obsAvailable: false,
  obsRunning: false,
  mode: 'none',
}

/**
 * Suit l'etat de la camera virtuelle "ChapCam Camera".
 * - En Electron : ecoute les evenements pousses par le main + polling de secours.
 * - Sur le web : renvoie un etat inerte (camera virtuelle indisponible hors app de bureau).
 *
 * NOUVEAUX AJOUTS pour WhatsApp/Telegram :
 * - Detection OBS disponible/en cours
 * - Mode OBS vs pilote akvirtualcamera
 * - Lancement auto d'OBS avec scene ChapCam
 */
export function useVirtualCamera() {
  const [state, setState] = useState<VirtualCameraState>(DEFAULT_STATE)
  // IMPORTANT : la detection doit rester APRES montage (useEffect), jamais
  // synchrone dans useState. `isElectron()` lit window.electronAPI : le
  // serveur Next (SSR) ne l'a pas (false) mais le client Electron l'a (true).
  // Une initialisation synchrone rendait `available` different entre le HTML
  // serveur et le premier rendu client -> React #418 (hydration mismatch) a
  // CHAQUE chargement de l'app Electron. On garde false au premier rendu
  // (identique SSR/client), puis on bascule apres montage.
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!isElectron()) return
    const api = getElectronAPI()
    // IMPORTANT : les anciennes versions de l'app de bureau exposent
    // window.electronAPI SANS le namespace `virtualCamera`. Appeler
    // api.virtualCamera.status() leverait "Cannot read properties of
    // undefined (reading 'status')". On verifie que la fonctionnalite
    // existe avant de l'utiliser.
    if (!api || typeof api.virtualCamera?.status !== 'function') return

    let active = true
    // Bascule differee d'un tick (regle react-hooks/set-state-in-effect) :
    // l'etat initial false (identique SSR) reste en place pendant le premier
    // rendu, puis on active l'indicateur apres montage.
    const t = setTimeout(() => {
      if (active) setAvailable(true)
    }, 0)

    // Etat initial
    api.virtualCamera
      .status()
      .then((s) => active && s && setState(s))
      .catch(() => {})

    // Evenements pousses par le process principal (peut ne pas exister)
    api.onVirtualCameraState?.((s) => {
      if (active && s) setState(s)
    })

    // Polling de secours (si un evenement est manque)
    const interval = setInterval(() => {
      api.virtualCamera
        ?.status?.()
        .then((s) => active && s && setState(s))
        .catch(() => {})
    }, 3000)

    return () => {
      active = false
      clearTimeout(t)
      clearInterval(interval)
    }
  }, [])

  const start = useCallback(async (opts?: { width?: number; height?: number; fps?: number }) => {
    const api = getElectronAPI()
    if (typeof api?.virtualCamera?.start !== 'function') return
    try {
      const s = await api.virtualCamera.start({ width: 1280, height: 720, fps: 30, ...opts })
      if (s) setState(s)
      return s
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur caméra virtuelle'
      const failed: VirtualCameraState = {
        ...DEFAULT_STATE,
        driverInstalled: state.driverInstalled,
        error: message,
      }
      setState(failed)
      return failed
    }
  }, [state.driverInstalled])

  const stop = useCallback(async () => {
    const api = getElectronAPI()
    if (typeof api?.virtualCamera?.stop !== 'function') return
    try {
      const s = await api.virtualCamera.stop()
      if (s) setState(s)
      return s
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur arrêt caméra virtuelle'
      setState((prev) => ({ ...prev, running: false, error: message }))
    }
  }, [])

  // Lancer OBS Studio (avec --startvirtualcam) depuis l'UI.
  // options.force = true : recrée la scene + redemarre OBS (bouton
  // « Recréer la source OBS » quand la capture est noire).
  // NOUVEAU : gere le mode OBS vs pilote et detection automatique.
  const launchObs = useCallback(async (options?: { force?: boolean }) => {
    const api = getElectronAPI()
    if (typeof api?.virtualCamera?.launchObs !== 'function') return null
    try {
      const result = await api.virtualCamera.launchObs(options)
      // Rafraichir l'etat (OBS tourne ou vient d'etre lance).
      api.virtualCamera
        ?.status?.()
        .then((s) => {
          if (s) {
            setState(prev => ({
              ...prev,
              obsAvailable: true,
              obsRunning: s.obsRunning ?? true,
              mode: s.mode === 'obs' ? 'obs' : s.mode === 'driver' ? 'driver' : prev.mode,
              deviceName: s.deviceName || prev.deviceName,
              running: s.running ?? false,
            }))
          }
        })
        .catch(() => {})
      // Le resultat contient `scene` (scene OBS auto-generee) : le composant
      // UI peut afficher « Scène ChapCam créée ».
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lancement OBS'
      setState((prev) => ({ ...prev, error: message }))
      return null
    }
  }, [])

  // Fallback manuel OBS -> pilote akvirtualcamera
  const fallbackToDriver = useCallback(async () => {
    const api = getElectronAPI()
    if (typeof api?.virtualCamera?.fallbackToDriver !== 'function') return null
    try {
      const result = await api.virtualCamera.fallbackToDriver()
      if (result && result.status) {
        setState(result.status)
      }
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur fallback'
      console.error('[useVirtualCamera] fallbackToDriver error:', message)
      return null
    }
  }, [])

  // NOUVEAU : Detecte si OBS est disponible et si la scene ChapCam existe.
  // Implemente via l'IPC `virtual-camera-status` existant (le main renvoie
  // deja obsAvailable / obsRunning / mode dans getStatus()).
  const detectObsAvailability = useCallback(async () => {
    const api = getElectronAPI()
    if (!api || typeof api.virtualCamera?.status !== 'function') return null
    try {
      const s = await api.virtualCamera.status()
      if (!s) return null
      const result = {
        obsAvailable: s.obsAvailable ?? false,
        obsRunning: s.obsRunning ?? false,
        mode: s.mode,
      }
      setState(prev => ({
        ...prev,
        obsAvailable: result.obsAvailable,
        obsRunning: result.obsRunning,
        mode: result.mode ?? prev.mode,
      }))
      return result
    } catch (_) {
      return null
    }
  }, [])

  // NOUVEAU : Get the current virtual camera status with full details
  const getDetailedStatus = useCallback(async () => {
    const api = getElectronAPI()
    if (!api || typeof api.virtualCamera?.status !== 'function') return
    try {
      const s = await api.virtualCamera.status()
      if (s) setState(s)
      return s
    } catch (_) {
      return null
    }
  }, [])

  return {
    state,
    available,
    start,
    stop,
    launchObs,
    fallbackToDriver,
    detectObsAvailability,
    getDetailedStatus,
  }
}