'use client'

import { Video, AlertTriangle, CheckCircle, Info, MonitorPlay, Loader2, HelpCircle, RefreshCw } from 'lucide-react'
import { useVirtualCamera } from '@/hooks/use-virtual-camera'
import { useState } from 'react'
import { ObsSetupGuide } from '@/components/obs-setup-guide'

/**
 * Indicateur visuel de l'etat du flux de diffusion (app de bureau uniquement).
 *
 * CHEMIN PRINCIPAL : OBS Virtual Camera. OBS Studio capture la fenetre ChapCam
 * (source "Capture de fenetre") et expose le flux via sa Virtual Camera :
 * WhatsApp, Zoom, Meet, Teams... selectionnent « OBS Virtual Camera ». C'est le
 * chemin qui fonctionne partout sans pilote systeme.
 *
 * FALLBACK : pilote akvirtualcamera embarque (« ChapCam Camera »).
 *
 * AMELIORATIONS :
 * - Detection d'echec de capture OBS (fenetre minimisee)
 * - Fallback automatique OBS -> pilote akvirtualcamera
 * - Guide interactif pour les nouveaux utilisateurs
 * - Notification WhatsApp/Télégramme explicite
 */
export function VirtualCameraIndicator({ className = '' }: { className?: string }) {
  const { state, available, launchObs, fallbackToDriver } = useVirtualCamera()
  const [showWhatsAppNote, setShowWhatsAppNote] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Hors app de bureau : pas de flux, on n'affiche rien.
  if (!available) return null

  const active = !!state.running
  const obsMode = state.mode === 'obs'

  // Lance OBS (et cree la scene "ChapCam" si absente). options.force recrée
  // la source meme si OBS tournait deja — utile quand la capture est noire.
  const handleLaunchObs = async (options?: { force?: boolean }) => {
    setLaunching(true)
    try {
      const result = await launchObs(options)
      // La scene OBS "ChapCam" (capture de la fenetre) a ete creee ET OBS a
      // ete lance par l'app : l'utilisateur n'a rien a configurer. Si OBS
      // tournait deja, la scene est en place pour le prochain lancement (le
      // --collection ne s'applique qu'au lancement) : pas de badge "creee".
      if (result && result.scene && result.scene.ok) {
        setSceneReady(true)
      }
    } finally {
      // Delai court : laisser OBS demarrer avant de rafraichir l'etat.
      setTimeout(() => setLaunching(false), 1500)
    }
  }

  // Gerer l'affichage du guide OBS
  const handleShowGuide = () => {
    setShowGuide(true)
  }

  if (active) {
    return (
      <>
        <div
          className={`flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 relative ${className}`}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <Video className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">
              {obsMode ? 'OBS Virtual Camera active' : 'ChapCam Camera active'}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {obsMode
                ? 'Visible dans WhatsApp, Zoom, Meet… Sélectionnez « OBS Virtual Camera »'
                : `${state.width}×${state.height} · ${state.fps} fps · visible dans WhatsApp, OBS, Zoom, Meet…`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => handleLaunchObs({ force: true })}
              disabled={launching}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground hover:text-primary hover:bg-white/10 transition-colors disabled:opacity-60"
              title="Recréer la source OBS ChapCam (utile si l'image est noire pendant l'appel)"
            >
              {launching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Recréer
            </button>
            <button
              onClick={() => setShowWhatsAppNote(!showWhatsAppNote)}
              className="flex h-6 w-6 items-center justify-center rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              title={showWhatsAppNote ? "Masquer l'aide WhatsApp" : "Voir l'aide WhatsApp"}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowGuide(true)}
              className="flex h-6 w-6 items-center justify-center rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              title="Guide de configuration OBS"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
          {showWhatsAppNote && (
            <div className="absolute bottom-full right-0 mb-2 w-80 rounded-lg border border-hairline bg-card p-4 shadow-lg z-10 animate-fade-in">
              <div className="flex items-start gap-2 text-[11px] text-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                <div>
                  <p className="font-medium mb-1">Pour WhatsApp :</p>
                  <ul className="space-y-1 list-disc list-inside text-muted-foreground">
                    <li>
                      <strong>WhatsApp Web</strong> (Chrome/Edge) → sélectionne{' '}
                      <strong>{obsMode ? '« OBS Virtual Camera »' : '« ChapCam Camera »'}</strong> ✅
                    </li>
                    <li>
                      <strong>WhatsApp Desktop .exe</strong> (site officiel) → sélectionne{' '}
                      <strong>{obsMode ? '« OBS Virtual Camera »' : '« ChapCam Camera »'}</strong> ✅
                    </li>
                    <li>
                      <strong>WhatsApp Microsoft Store</strong> →{' '}
                      <span className="text-amber-400">NE VOIT PAS</span> les caméras virtuelles
                      (sandbox)
                    </li>
                  </ul>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {obsMode
                      ? 'Garde la fenêtre ChapCam visible (non minimisée) pendant l\'appel, sinon le flux capturé par OBS est noir.'
                      : 'Garde la fenêtre ChapCam visible (non minimisée) pendant l\'appel, sinon le flux est noir.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        {showGuide && (
          <ObsSetupGuide
            obsAvailable={state.obsAvailable || false}
            obsRunning={state.obsRunning || false}
            onLaunchObs={launchObs}
            onClose={() => setShowGuide(false)}
          />
        )}
      </>
    )
  }

  // Cas 1 : OBS est installe mais pas lance — chemin principal à activer.
  if (state.obsAvailable && !state.obsRunning) {
    return (
      <>
        <div
          className={`flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 ${className}`}
        >
          <MonitorPlay className="h-4 w-4 shrink-0 text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-400">Lancez OBS pour diffuser</p>
            <p className="truncate text-[11px] text-muted-foreground">
              OBS Virtual Camera démarre automatiquement avec OBS
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              onClick={() => handleLaunchObs({ force: true })}
              disabled={launching}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-blue-300 transition-colors hover:bg-blue-500/30 disabled:opacity-60"
            >
              {launching ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Lancement…
                </>
              ) : (
                <>
                  <MonitorPlay className="h-3 w-3" /> Lancer OBS
                </>
              )}
            </button>
            <button
              onClick={handleShowGuide}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-blue-300/70 transition-colors hover:bg-blue-500/20"
            >
              <HelpCircle className="h-3 w-3" /> Guide
            </button>
            {sceneReady && (
              <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                <CheckCircle className="h-2.5 w-2.5" /> Scène « ChapCam » créée
              </span>
            )}
          </div>
        </div>
        {showGuide && (
          <ObsSetupGuide
            obsAvailable={state.obsAvailable || false}
            obsRunning={state.obsRunning || false}
            onLaunchObs={launchObs}
            onClose={() => setShowGuide(false)}
          />
        )}
      </>
    )
  }

  // Cas 2 : ni OBS, ni pilote — blocage.
  if (!state.obsAvailable && !state.driverInstalled) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 ${className}`}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-500">Aucune caméra virtuelle détectée</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Installez OBS Studio (obsproject.com) pour diffuser
          </p>
        </div>
        <Info className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-500/70" />
      </div>
    )
  }

  // Cas 3 : rien d'actif, pas d'erreur — prêt (pilote installé en fallback)
  return (
    <>
      <div
        className={`flex items-center gap-2 rounded-lg border border-hairline bg-muted px-3 py-2 ${className}`}
      >
        <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">Prêt à diffuser</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Lancez OBS pour créer la caméra, puis démarrez le Live Swap
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => handleLaunchObs({ force: true })}
            disabled={launching}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-blue-300 transition-colors hover:bg-blue-500/30 disabled:opacity-60"
            title="Lance OBS et crée la source « ChapCam » automatiquement"
          >
            {launching ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Lancement…
              </>
            ) : (
              <>
                <MonitorPlay className="h-3 w-3" /> Lancer OBS
              </>
            )}
          </button>
          <button
            onClick={handleShowGuide}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
            title="Guide de configuration OBS"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          {state.mode === 'obs' && (
            <button
              onClick={fallbackToDriver}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
              title="Basculer sur ChapCam Camera"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {showGuide && (
        <ObsSetupGuide
          obsAvailable={state.obsAvailable || false}
          obsRunning={state.obsRunning || false}
          onLaunchObs={launchObs}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  )
}