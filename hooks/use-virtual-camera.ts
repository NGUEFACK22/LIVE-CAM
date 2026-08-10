'use client'

import { useEffect, useState, useCallback } from 'react'
import { getElectronAPI, isElectron, type VirtualCameraState } from '@/lib/electron'

const DEFAULT_STATE: VirtualCameraState = {
  running: false,
  deviceName: 'ChapCam Camera',
  driverInstalled: false,
  error: null,
}

/**
 * Suit l'etat de la camera virtuelle "ChapCam Camera".
 * - En Electron : ecoute les evenements pousses par le main + polling de secours.
 * - Sur le web : renvoie un etat inerte (camera virtuelle indisponible hors app de bureau).
 */
export function useVirtualCamera() {
  const [state, setState] = useState<VirtualCameraState>(DEFAULT_STATE)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    if (!isElectron()) {
      setAvailable(false)
      return
    }
    const api = getElectronAPI()
    // IMPORTANT : les anciennes versions de l'app de bureau ChapCam exposent
    // window.electronAPI SANS le namespace `virtualCamera`. Appeler
    // api.virtualCamera.status() levait alors "Cannot read properties of
    // undefined (reading 'status')", ce qui faisait planter Live Swap ET
    // Live Pro (les deux affichent VirtualCameraIndicator). On verifie donc
    // que la fonctionnalite existe avant de l'utiliser.
    if (!api || typeof api.virtualCamera?.status !== 'function') {
      setAvailable(false)
      return
    }
    setAvailable(true)

    let active = true

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
  // « Recréer la source OBS » quand la capture reste noire).
  const launchObs = useCallback(async (options?: { force?: boolean }) => {
    const api = getElectronAPI()
    if (typeof api?.virtualCamera?.launchObs !== 'function') return null
    try {
      const result = await api.virtualCamera.launchObs(options)
      // Rafraichir l'etat (OBS tourne ou vient d'etre lance).
      api.virtualCamera
        ?.status?.()
        .then((s) => s && setState(s))
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

  return { state, available, start, stop, launchObs, fallbackToDriver }
}
