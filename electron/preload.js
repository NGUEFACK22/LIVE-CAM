const { contextBridge, ipcRenderer } = require('electron')

// ============================================================
// ChapCam Desktop - Preload
//
// Deux roles :
//   1. Exposer une API sure (electronAPI) a la page web (contextBridge).
//   2. Faire tourner le MOTEUR DE CAPTURE de la sortie transformee :
//      on lit en continu le <canvas>/<video> tagge [data-chapcam-output],
//      on le redessine a la resolution cible, puis on envoie chaque frame
//      (RGBA brut) au process principal -> camera virtuelle "ChapCam Camera".
//
// La capture lit les VRAIS pixels (pas la transformation CSS -scale-x-100),
// donc la camera virtuelle n'est PAS miroir cote interlocuteurs.
// ============================================================

// ---- Etat du moteur de capture (vit dans le contexte isole du preload) ----
const capture = {
  running: false,
  rafId: null,
  width: 1280,
  height: 720,
  fps: 30,
  lastSentAt: 0,
  scratch: null, // canvas hors-ecran reutilise
  ctx: null,
  missWarned: false,
}

// Recadrage "portrait" de la sortie avant envoi au pilote.
// Lucy ne swap que le visage : le corps/les vetements reels de l'utilisateur
// restent visibles. On zoome donc sur le haut de l'image (visage + epaules)
// pour qu'ils disparaissent du champ — l'interlocuteur ne voit que l'avatar.
const VCAM_CROP = {
  enabled: true,
  zoom: 1.8, // x : plus c'est grand, plus on rapproche du visage
  anchorY: 0.15, // 0 = tout en haut, 1 = en bas (position du zoom vertical)
}

function ensureScratch(w, h) {
  if (!capture.scratch) {
    capture.scratch = document.createElement('canvas')
    capture.ctx = capture.scratch.getContext('2d', { willReadFrequently: true })
  }
  if (capture.scratch.width !== w || capture.scratch.height !== h) {
    capture.scratch.width = w
    capture.scratch.height = h
  }
}

// Trouve la source a diffuser : UNIQUEMENT l'element tagge [data-chapcam-output].
// Si la source transformee n'est pas encore prete, on renvoie null pour que
// la camera virtuelle reste noire au lieu de montrer le visage reel (fallback
// sur la webcam locale faisait voir l'utilisateur a la place de l'avatar).
function findSource() {
  const tagged = document.querySelector('[data-chapcam-output]')
  if (tagged && isUsable(tagged)) {
    const d = srcDims(tagged)
    if (!capture.missWarned) {
      console.log(`[ChapCam][capture] DIAG: source trouvee — tag=${tagged.tagName} dims=${d.w}x${d.h}`)
    }
    return tagged
  }
  if (!tagged) {
    if (!capture.missWarned) console.warn('[ChapCam][capture] DIAG: Aucun element [data-chapcam-output] dans le DOM')
  } else if (!isUsable(tagged)) {
    if (!capture.missWarned) console.warn(`[ChapCam][capture] DIAG: element [data-chapcam-output] present mais inutilisable — tag=${tagged.tagName} readyState=${tagged.tagName==='VIDEO'?tagged.readyState:'N/A'} videoWidth=${tagged.tagName==='VIDEO'?tagged.videoWidth:'N/A'}`)
  }
  return null
}

function isUsable(el) {
  if (!el) return false
  if (el.tagName === 'VIDEO') {
    return el.readyState >= 1 && el.videoWidth > 0 && el.videoHeight > 0
  }
  if (el.tagName === 'CANVAS') {
    return el.width > 0 && el.height > 0
  }
  return false
}

function srcDims(el) {
  if (el.tagName === 'VIDEO') return { w: el.videoWidth, h: el.videoHeight }
  return { w: el.width, h: el.height }
}

// Dessine la source dans le scratch en "cover" zoomé vers le visage.
// On garde le ratio (pas de deformation), on centre horizontalement et on
// ancre vers le haut : le haut du buste / le visage remplissent le cadre et
// les vetements du buste/torse disparaissent.
function drawContain(ctx, el, sw, sh, dw, dh) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, dw, dh)

  const zoom = VCAM_CROP.enabled ? Math.max(1, VCAM_CROP.zoom || 1) : 1
  const anchorY = VCAM_CROP.enabled ? Math.min(1, Math.max(0, VCAM_CROP.anchorY || 0.15)) : 0.5

  // Zone source visible apres zoom (meme ratio que la cible).
  let cropW = sw / zoom
  let cropH = sh / zoom
  const targetAR = dw / dh
  const srcAR = cropW / cropH
  if (srcAR > targetAR) {
    cropH = cropW / targetAR
  } else if (srcAR < targetAR) {
    cropW = cropH * targetAR
  }

  // Centre horizontalement ; verticalement on ancre vers le haut
  // (anchorY=0 -> la zone source commence en haut de l'image source).
  const sx = (sw - cropW) / 2
  const sy = Math.max(0, (sh - cropH) * anchorY)

  ctx.drawImage(el, sx, sy, cropW, cropH, 0, 0, dw, dh)
}

function sendBlackFrame() {
  ensureScratch(capture.width, capture.height)
  if (!capture.ctx) return
  capture.ctx.fillStyle = '#000000'
  capture.ctx.fillRect(0, 0, capture.width, capture.height)
  const img = capture.ctx.getImageData(0, 0, capture.width, capture.height)
  const copy = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength)
  ipcRenderer.send('vcam:frame', {
    width: capture.width,
    height: capture.height,
    buffer: copy,
  })
  capture.lastSentAt = performance.now()
}

function tick() {
  if (!capture.running) return

  const now = performance.now()
  const minInterval = 1000 / Math.max(1, capture.fps)
  if (now - capture.lastSentAt >= minInterval) {
    const src = findSource()
    if (src) {
      capture.missWarned = false
      const { w: sw, h: sh } = srcDims(src)
      if (sw > 0 && sh > 0) {
        ensureScratch(capture.width, capture.height)
        try {
          if (!capture.ctx) {
            throw new Error('contexte 2d indisponible')
          }
          drawContain(capture.ctx, src, sw, sh, capture.width, capture.height)
          const img = capture.ctx.getImageData(0, 0, capture.width, capture.height)
          // Copie du buffer : apres send, le clone IPC peut detacher / reutiliser
          // le underlying ArrayBuffer selon la version d'Electron. Une slice
          // garantit que getImageData reste valide pour la frame suivante.
          const copy = img.data.buffer.slice(
            img.data.byteOffset,
            img.data.byteOffset + img.data.byteLength,
          )
          ipcRenderer.send('vcam:frame', {
            width: capture.width,
            height: capture.height,
            buffer: copy,
          })
          capture.lastSentAt = now
        } catch (e) {
          // getImageData peut lever si la source est "tainted" (cross-origin).
          // Le flux ChapCam est same-origin/WebRTC donc OK ; on log une fois.
          if (!capture.missWarned) {
            console.warn('[ChapCam][capture] frame illisible:', e && e.message ? e.message : e)
            capture.missWarned = true
          }
        }
      }
    } else {
      // Pas de source transformee disponible : envoyer du noir pour que
      // WhatsApp/Zoom/Teams ne voient jamais le visage reel par erreur.
      sendBlackFrame()
      if (!capture.missWarned) {
        console.warn('[ChapCam][capture] source transformee indisponible — envoi frame noire')
        capture.missWarned = true
      }
    }
  }

  capture.rafId = requestAnimationFrame(tick)
}

function startCapture(opts = {}) {
  capture.width = (opts && opts.width) || 1280
  capture.height = (opts && opts.height) || 720
  capture.fps = (opts && opts.fps) || 30
  // Si deja en cours : mettre a jour la resolution/fps et continuer
  // (evite un trou noir pendant un re-start suite a un toggle UI).
  if (capture.running) {
    console.log(`[ChapCam][capture] deja active — maj ${capture.width}x${capture.height}@${capture.fps}`)
    return
  }
  capture.running = true
  capture.lastSentAt = 0
  capture.missWarned = false
  const src = findSource()
  const srcInfo = src ? `${src.tagName} ${srcDims(src).w}x${srcDims(src).h}` : 'aucune'
  console.log(`[ChapCam][capture] demarree ${capture.width}x${capture.height}@${capture.fps} — source: ${srcInfo}`)
  // Reinitialiser missWarned pour que le log DIAG reapparaisse au prochain tick
  capture.missWarned = false
  capture.rafId = requestAnimationFrame(tick)
}

function stopCapture() {
  const wasRunning = capture.running
  capture.running = false
  if (capture.rafId != null) {
    cancelAnimationFrame(capture.rafId)
    capture.rafId = null
  }
  if (wasRunning) {
    console.log('[ChapCam][capture] arretee')
  }
}

// ============================================================
// DETECTION D'ECRAN NOIR OBS (fix 1.0.10)
// ----------------------------------------------------------------------------
// Sur certaines machines (ex: GPU AMD + WGC defectueux sous Windows 11/25H2),
// la Virtual Camera d'OBS diffuse du NOIR : la capture de fenetre WGC ne sort
// AUCUN pixel, meme pour le bureau Windows. On le detecte en ouvrant brievement
// la Virtual Camera OBS avec getUserMedia et en mesurant la luminance reelle
// des frames : si tout est noir, on bascule AUTOMATIQUEMENT sur le pilote
// ChapCam Camera (qui pousse les pixels de l'avatar directement, sans dependre
// de la capture OBS). OBS reste la methode prioritaire — la bascule n'arrive
// que lorsque sa sortie est reellement noire.
// ----------------------------------------------------------------------------

// Mesure la luminance max d'une frame video (sous-echantillon).
function frameMaxLuma(video, w, h) {
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
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

// Lit `frames` frames du stream et renvoie true si elles sont (quasi) noires.
function isStreamBlack(stream, frames = 3) {
  return new Promise((resolve) => {
    let settled = false
    const done = (black) => {
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
          try { video.srcObject = null } catch (_) {}
          video.remove()
          done(minMax < 40) // < 40 : image quasi noire
        } else {
          setTimeout(checkFrame, 150)
        }
      }
      video.onloadedmetadata = () => video.play().catch(() => {})
      video.onplaying = checkFrame
      video.onloadeddata = checkFrame
      // Securite : si aucune frame n'arrive, on considere noir (bascule).
      setTimeout(() => {
        try { video.srcObject = null } catch (_) {}
        video.remove()
        done(minMax < 40 || checked < frames ? true : false)
      }, 4000)
    } catch (_) {
      done(true)
    }
  })
}

// Bascule sur le pilote ChapCam Camera + demarre la capture de l'avatar.
async function switchToDriver(opts) {
  try {
    const res = await ipcRenderer.invoke('virtual-camera-fallback-to-driver')
    if (res && res.fallback && res.status && res.status.running) {
      startCapture(opts || {})
      console.warn('[ChapCam] BAScule automatique sur ChapCam Camera (Virtual Camera OBS noire)')
    } else {
      console.warn('[ChapCam] bascule pilote echouee (fallback=', res && res.fallback, ')')
    }
  } catch (e) {
    console.warn('[ChapCam] bascule pilote:', e && e.message ? e.message : e)
  }
}

// Verifie que la Virtual Camera OBS sort de vrais pixels ; sinon bascule auto.
async function autoFallbackIfObsBlack(opts) {
  // Laisser la vcam OBS demarrer et la scene se charger avant de tester.
  await new Promise((r) => setTimeout(r, 2500))
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000))
    let stream = null
    try {
      // Les labels des devices ne sont visibles qu'apres un getUserMedia
      // (permission camera deja accordee par le Live Swap, sinon on tente).
      try {
        const perm = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 90 } })
        perm.getTracks().forEach((t) => t.stop())
      } catch (_) {}
      const devices = await navigator.mediaDevices.enumerateDevices()
      const obsCam = devices.find((d) => d.kind === 'videoinput' && /OBS Virtual Camera/i.test(d.label || ''))
      if (!obsCam) {
        console.warn('[ChapCam] OBS Virtual Camera introuvable — verification skippee')
        return
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: obsCam.deviceId }, width: 160, height: 90 },
      })
      const black = await isStreamBlack(stream)
      if (black) {
        await switchToDriver(opts)
      } else {
        console.log('[ChapCam] Virtual Camera OBS OK — pixels visibles, OBS conserve')
      }
      return
    } catch (e) {
      console.warn('[ChapCam] verification OBS vcam (essai', attempt + 1, '):', e && e.message ? e.message : e)
    } finally {
      if (stream) {
        try { stream.getTracks().forEach((t) => t.stop()) } catch (_) {}
      }
    }
  }
}

// Pilotage depuis le process principal (menu / tray / UI)
ipcRenderer.on('vcam:start', (_e, opts) => startCapture(opts))
ipcRenderer.on('vcam:stop', () => stopCapture())

// ============================================================
// API exposee a la page web
// ============================================================
contextBridge.exposeInMainWorld('electronAPI', {
  // Camera access
  getCameraAccess: () => ipcRenderer.invoke('get-camera-access'),
  requestCameraAccess: () => ipcRenderer.invoke('request-camera-access'),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Camera virtuelle : controle direct depuis l'UI web
  // On demarre AUSSI la capture locale ici (filet de securite) : le main
  // envoie normalement vcam:start apres virtual-camera-start, mais si une
  // ancienne build du main ne le fait pas, les frames partent quand meme.
  //
  // IMPORTANT : on ne demarre la capture QUE si le pilote a reussi a demarrer
  // (status.running). Sinon on brulerait du CPU a capturer pour un pipe mort,
  // et l'UI croirait a tort que le partage est actif.
  virtualCamera: {
    start: async (opts) => {
      try {
        const status = await ipcRenderer.invoke('virtual-camera-start', opts)
        // En mode OBS, OBS capture la fenetre ChapCam directement : aucune
        // capture pixel cote renderer (inutile et couteuse en CPU). En mode
        // pilote, on demarre la capture pour pousser les frames au pilote.
        if (status && status.running && status.mode !== 'obs') {
          startCapture(opts || {})
        } else {
          // Echec demarrage (ou mode OBS) : s'assurer que la capture est
          // bien arretee.
          stopCapture()
          // Mode OBS actif : verifier que la Virtual Camera OBS sort de VRAIS
          // pixels. Sur certaines machines (WGC casse -> noir), on bascule
          // automatiquement sur le pilote ChapCam Camera (fix 1.0.10).
          if (status && status.running && status.mode === 'obs') {
            console.log('[ChapCam][capture] DIAG: mode OBS actif — OBS capture la fenetre directement. Capture preload desactivee (economie CPU).')
            autoFallbackIfObsBlack(opts || {}).catch(() => {})
          }
        }
        return status
      } catch (e) {
        stopCapture()
        console.error('[ChapCam] virtualCamera.start failed:', e)
        return {
          running: false,
          deviceName: 'ChapCam Camera',
          driverInstalled: false,
          error: e && e.message ? e.message : String(e),
        }
      }
    },
    stop: async () => {
      stopCapture()
      try {
        return await ipcRenderer.invoke('virtual-camera-stop')
      } catch (e) {
        console.error('[ChapCam] virtualCamera.stop failed:', e)
        return {
          running: false,
          deviceName: 'ChapCam Camera',
          driverInstalled: false,
          error: e && e.message ? e.message : String(e),
        }
      }
    },
    status: () => ipcRenderer.invoke('virtual-camera-status'),
    // Lancer OBS Studio (avec --startvirtualcam) depuis l'UI.
    // options.force = true : recrée la scene + redemarre OBS.
    launchObs: (options) => ipcRenderer.invoke('virtual-camera-launch-obs', options),
    // Fallback manuel OBS -> pilote akvirtualcamera
    fallbackToDriver: async () => {
      try {
        const result = await ipcRenderer.invoke('virtual-camera-fallback-to-driver')
        // Si le fallback a reussi, demarrer la capture pilote
        if (result && result.fallback && result.status && result.status.running && result.status.mode !== 'obs') {
          startCapture({ width: 1280, height: 720, fps: 30 })
        }
        return result
      } catch (e) {
        console.error('[ChapCam] virtualCamera.fallbackToDriver failed:', e)
        return { fallback: false, status: null }
      }
    },
  },

  // Evenement : le main demande d'activer/desactiver la camera virtuelle
  onVirtualCameraToggle: (callback) => {
    ipcRenderer.on('virtual-camera-toggle', (_event, enabled) => callback(enabled))
  },

  // Etat de la camera virtuelle pousse par le main (pour l'UI)
  onVirtualCameraState: (callback) => {
    ipcRenderer.on('virtual-camera-state', (_event, state) => callback(state))
  },

  // Voice Swap : conversion de voix temps reel (architecture/scaffolding).
  // Meme pattern que virtualCamera. Le streaming reel n'est pas encore branche.
  voiceSwap: {
    status: () => ipcRenderer.invoke('voice-swap-status'),
    listDevices: () => ipcRenderer.invoke('voice-swap-list-devices'),
    listVoices: () => ipcRenderer.invoke('voice-swap-list-voices'),
    start: (config) => ipcRenderer.invoke('voice-swap-start', config),
    stop: () => ipcRenderer.invoke('voice-swap-stop'),
    updateSettings: (settings) => ipcRenderer.invoke('voice-swap-update-settings', settings),
    // Etat pousse par le main process (latence, sante connexion, buffering).
    onState: (callback) => {
      ipcRenderer.on('voice-swap-state', (_event, state) => callback(state))
    },
    // Conversion d'un segment audio : envoie le PCM capture, recoit le PCM
    // converti par ElevenLabs (aller-retour reel).
    convert: (payload) => ipcRenderer.invoke('voice-swap-convert', payload),
    // Remonte les metriques mesurees cote renderer (capture/playback/buffer).
    reportMetrics: (metrics) => ipcRenderer.send('voice-swap-metrics', metrics),
  },

  // Navigation events
  onOpenPreferences: (callback) => {
    ipcRenderer.on('open-preferences', () => callback())
  },
  onOpenCameraSettings: (callback) => {
    ipcRenderer.on('open-camera-settings', () => callback())
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // Platform detection
  isElectron: true,
  platform: process.platform,

  // Journal de diagnostic : recuperer / vider les logs (ecran noir)
  getDebugLog: () => ipcRenderer.invoke('get-debug-log'),
  clearDebugLog: () => ipcRenderer.invoke('clear-debug-log'),
})

console.log('[ChapCam] Preload script initialized')
