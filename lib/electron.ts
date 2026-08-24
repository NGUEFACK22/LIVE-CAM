// Etat de la camera virtuelle ChapCam
export interface VirtualCameraState {
  running: boolean
  deviceName: string
  driverInstalled: boolean
  width?: number
  height?: number
  fps?: number
  error?: string | null
  /** Vrai quand le pont OBS (obs64.exe + OBS Virtual Camera) est actif. */
  obsBridge?: boolean
  /** Vrai quand OBS Studio tourne (obs64.exe detecte). */
  obsRunning?: boolean
  /** Vrai quand OBS Studio est installe sur la machine. */
  obsAvailable?: boolean
  /** Chemin de diffusion actif : 'obs' (principal) | 'driver' | 'none'. */
  mode?: 'obs' | 'driver' | 'none'
}

// Contrat de l'API Voice Swap (defini dans lib/voice-swap.ts) expose par le
// preload sous window.electronAPI.voiceSwap.
import type { VoiceSwapAPI } from '@/lib/voice-swap'

// Electron API types for ChapCam Desktop
export interface ElectronAPI {
  // Camera access
  getCameraAccess: () => Promise<'granted' | 'denied' | 'restricted' | 'unknown'>
  requestCameraAccess: () => Promise<'granted' | 'denied' | 'restricted' | 'unknown'>
  
  // App info
  getAppVersion: () => Promise<string>
  getPlatform: () => Promise<NodeJS.Platform>
  
  // Virtual camera
  onVirtualCameraToggle: (callback: (enabled: boolean) => void) => void
  virtualCamera: {
    start: (opts?: { width?: number; height?: number; fps?: number; forceDriver?: boolean }) => Promise<VirtualCameraState>
    stop: () => Promise<VirtualCameraState>
    status: () => Promise<VirtualCameraState>
    launchObs?: (options?: { force?: boolean }) => Promise<{
      launched: boolean
      alreadyRunning: boolean
      /** Vrai quand OBS tournait deja et a ete redemarre pour charger la scene a jour. */
      restarted?: boolean
      exe?: string | null
      error?: string
      /** Scene OBS "ChapCam" (capture de la fenetre) creee/rafraichie au lancement. */
      scene?: {
        ok: boolean
        file?: string
        sceneName?: string
        error?: string
      }
    }>
    /** Force le pilote akvirtualcamera (ChapCam Camera) au lieu d'OBS. */
    fallbackToDriver?: () => Promise<{ status: VirtualCameraState } | null>
  }
  onVirtualCameraState: (callback: (state: VirtualCameraState) => void) => void
  
  // Voice Swap : conversion de voix temps reel (app de bureau uniquement).
  // Optionnel : absent sur le web et sur les anciennes versions de l'app.
  voiceSwap?: VoiceSwapAPI
  
  // Navigation events
  onOpenPreferences: (callback: () => void) => void
  onOpenCameraSettings: (callback: () => void) => void
  
  // Window controls
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  
  // Platform detection
  isElectron: boolean
  platform: NodeJS.Platform

  // Journal de diagnostic : recuperer / vider les logs (ecran noir)
  getDebugLog?: () => Promise<string>
  clearDebugLog?: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron
}

/**
 * Get the Electron API safely
 */
export function getElectronAPI(): ElectronAPI | null {
  if (isElectron()) {
    return window.electronAPI!
  }
  return null
}

/**
 * Request camera access (works in both web and Electron)
 */
export async function requestCameraAccess(): Promise<boolean> {
  const api = getElectronAPI()
  
  if (api) {
    // Electron environment
    const status = await api.requestCameraAccess()
    return status === 'granted'
  } else {
    // Web environment
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(track => track.stop())
      return true
    } catch {
      return false
    }
  }
}

/**
 * Get current platform
 */
export function getPlatform(): 'mac' | 'windows' | 'linux' | 'web' {
  const api = getElectronAPI()
  
  if (api) {
    switch (api.platform) {
      case 'darwin': return 'mac'
      case 'win32': return 'windows'
      case 'linux': return 'linux'
      default: return 'web'
    }
  }
  
  return 'web'
}

/**
 * Get app version
 */
export async function getAppVersion(): Promise<string> {
  const api = getElectronAPI()
  
  if (api) {
    return api.getAppVersion()
  }
  
  return '1.0.13'
}
