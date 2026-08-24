'use client'

import { useState, useEffect } from 'react'
import { 
  MonitorPlay, 
  Video, 
  CheckCircle, 
  AlertTriangle, 
  Info, 
  ArrowRight, 
  ArrowLeft,
  ExternalLink,
  Loader2
} from 'lucide-react'

interface ObsSetupGuideProps {
  obsAvailable: boolean
  obsRunning: boolean
  onLaunchObs?: () => Promise<{
    launched: boolean
    alreadyRunning: boolean
    restarted?: boolean
    exe?: string | null
    error?: string
    scene?: { ok: boolean; file?: string; sceneName?: string; error?: string }
  } | null>
  onClose?: () => void
}

type Step = 'welcome' | 'check-obs' | 'launch-obs' | 'configure-obs' | 'select-camera' | 'test-stream' | 'complete'

export function ObsSetupGuide({ obsAvailable, obsRunning, onLaunchObs, onClose }: ObsSetupGuideProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<{
    launched: boolean
    alreadyRunning: boolean
    restarted?: boolean
    scene?: { ok: boolean; file?: string; sceneName?: string; error?: string }
  } | null>(null)
  const [sceneCreated, setSceneCreated] = useState(false)

  // Auto-advance si OBS est déjà détecté : ajustement d'état pendant le
  // rendu (pattern React documenté) — les gardes sur currentStep évitent
  // toute boucle de rendu.
  if (obsRunning && currentStep === 'check-obs') {
    setCurrentStep('configure-obs')
  } else if (obsAvailable && !obsRunning && currentStep === 'welcome') {
    setCurrentStep('launch-obs')
  }

  const steps: Step[] = ['welcome', 'check-obs', 'launch-obs', 'configure-obs', 'select-camera', 'test-stream', 'complete']
  const currentStepIndex = steps.indexOf(currentStep)

  const nextStep = () => {
    const nextIndex = Math.min(currentStepIndex + 1, steps.length - 1)
    setCurrentStep(steps[nextIndex])
  }

  const prevStep = () => {
    const prevIndex = Math.max(currentStepIndex - 1, 0)
    setCurrentStep(steps[prevIndex])
  }

  const handleLaunchObs = async () => {
    if (!onLaunchObs) return
    
    setIsLaunching(true)
    try {
      const result = await onLaunchObs()
      setLaunchResult(result)
      if (result?.scene?.ok) {
        setSceneCreated(true)
      }
      // Avancer à l'étape suivante après un court délai
      setTimeout(() => {
        setCurrentStep('configure-obs')
      }, 2000)
    } finally {
      setIsLaunching(false)
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
              <MonitorPlay className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Bienvenue dans ChapCam !</h3>
            <p className="text-muted-foreground">
              Ce guide va vous aider à configurer OBS Studio pour diffuser votre face swap
              sur WhatsApp, Zoom, Teams et d&apos;autres applications.
            </p>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-blue-200">
                  <strong>Prérequis :</strong> OBS Studio doit être installé. 
                  Si ce n&apos;est pas le cas, téléchargez-le sur <a href="https://obsproject.com" target="_blank" rel="noopener" className="underline">obsproject.com</a>
                </p>
              </div>
            </div>
          </div>
        )

      case 'check-obs':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
            <h3 className="text-lg font-semibold">Vérification d&apos;OBS Studio...</h3>
            <p className="text-muted-foreground">
              {obsAvailable 
                ? 'OBS Studio est détecté sur votre système !'
                : 'Recherche de OBS Studio en cours...'}
            </p>
          </div>
        )

      case 'launch-obs':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">OBS Studio détecté !</h3>
            <p className="text-muted-foreground">
              ChapCam va lancer OBS Studio automatiquement avec la bonne configuration.
            </p>
            <button
              onClick={handleLaunchObs}
              disabled={isLaunching}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isLaunching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Lancement en cours...
                </>
              ) : (
                <>
                  <MonitorPlay className="w-4 h-4" />
                  Lancer OBS Studio
                </>
              )}
            </button>
            {launchResult && (
              <div className={`text-sm ${launchResult.launched ? 'text-green-400' : 'text-amber-400'}`}>
                {launchResult.launched
                  ? launchResult.restarted
                    ? '🔄 OBS Studio redémarré avec la scène « ChapCam » !'
                    : '✅ OBS Studio a été lancé !'
                  : '⚠️ OBS Studio était déjà en cours d\'exécution'}
              </div>
            )}
          </div>
        )

      case 'configure-obs':
        return (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                <Video className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mt-4">Configuration OBS</h3>
              <p className="text-muted-foreground">
                La scene &quot;ChapCam&quot; a été créée automatiquement dans OBS.
              </p>
            </div>
            
            {sceneCreated && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <p className="text-green-200">
                    <strong>Scène &quot;ChapCam&quot; créée !</strong><br />
                    OBS a été lancé avec la scène préconfigurée. La source &quot;Capture de fenetre&quot;
                    pointe automatiquement vers la fenêtre ChapCam.
                  </p>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <h4 className="font-medium">Vérifications :</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <span>OBS Studio est en cours d&apos;exécution</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <span>La scene &quot;ChapCam&quot; est chargée</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                  <span>La Virtual Camera OBS est active</span>
                </li>
              </ul>
            </div>
          </div>
        )

      case 'select-camera':
        return (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center">
                <Video className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold mt-4">Sélection de la caméra</h3>
              <p className="text-muted-foreground">
                Dans votre application de visioconférence, sélectionnez &quot;OBS Virtual Camera&quot;.
              </p>
            </div>
            
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">Applications compatibles :</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400"></span>
                  <span>WhatsApp Web (Chrome/Edge)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400"></span>
                  <span>WhatsApp Desktop .exe</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400"></span>
                  <span>Zoom, Teams, Google Meet</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  <span>WhatsApp Microsoft Store (sandbox)</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-amber-200">
                  <strong>Important :</strong> Gardez la fenêtre ChapCam visible pendant l&apos;appel.
                  Si elle est minimisée, OBS affichera un écran noir.
                </p>
              </div>
            </div>
          </div>
        )

      case 'test-stream':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
              <Video className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Test du flux</h3>
            <p className="text-muted-foreground">
              Démarrez le Live Swap dans ChapCam pour voir le flux apparaître dans votre application.
            </p>
            <div className="bg-muted rounded-lg p-4 text-left text-sm space-y-2">
              <p><strong>1.</strong> Dans ChapCam, cliquez sur &quot;Démarrer le Live Swap&quot;</p>
              <p><strong>2.</strong> Attendez la première image transformée (compteur de points)</p>
              <p><strong>3.</strong> Dans votre application, sélectionnez &quot;OBS Virtual Camera&quot;</p>
              <p><strong>4.</strong> Vérifiez que le flux apparaît</p>
            </div>
          </div>
        )

      case 'complete':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">Configuration terminée !</h3>
            <p className="text-muted-foreground">
              Vous êtes prêt à utiliser ChapCam avec OBS Virtual Camera.
            </p>
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <p className="text-green-200">
                  <strong>Rappel :</strong> Gardez la fenêtre ChapCam visible pendant les appels
                  pour que le flux continue d&apos;être capturé par OBS.
                </p>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl border border-hairline shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {renderStep()}
          
          {/* Navigation */}
          <div className="flex justify-between mt-6 pt-4 border-t border-hairline">
            {currentStepIndex > 0 ? (
              <button
                onClick={prevStep}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour
              </button>
            ) : (
              <div />
            )}
            
            {currentStep !== 'complete' ? (
              <button
                onClick={nextStep}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Suivant
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <CheckCircle className="w-4 h-4" />
                Commencer
              </button>
            )}
          </div>
          
          {/* Progression */}
          <div className="mt-4 flex justify-center gap-1">
            {steps.map((step, index) => (
              <div
                key={step}
                className={`w-2 h-2 rounded-full transition-colors ${
                  index === currentStepIndex
                    ? 'bg-primary'
                    : index < currentStepIndex
                    ? 'bg-primary/50'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}