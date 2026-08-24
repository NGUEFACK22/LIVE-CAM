const { app, BrowserWindow, ipcMain, systemPreferences, Menu, Tray, nativeImage, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// ---- CAPTURE OBS (fix ecran noir 1.0.9) --------------------------------
// OBS capture la fenetre ChapCam. La methode WGC (Windows Graphics Capture)
// choisie par defaut par OBS ne peut PAS capturer le contenu d'une fenetre
// Electron acceleree materiellement (compositeur GPU + video hardware) : le
// flux envoye a WhatsApp/Zoom/Meet est alors NOIR. On desactive l'acceleration
// materielle : la fenetre est rendue par le compositeur LOGICIEL, et OBS
// (WGC comme BitBlt) la capture correctement. La face-swap tournant dans le
// cloud, le rendu local (video + canvas 2D) reste fluide en 720p30.
// A appeler AVANT app.whenReady() — c'est le correctif recommande par
// Electron/la communaute OBS pour les apps capturees en noir.
app.disableHardwareAcceleration()

// ---- VERROU SINGLE-INSTANCE ----------------------------------------------
// Critique pour la capture OBS : la scene ChapCam capture la fenetre par le
// string Titre:Classe:Exe. Si DEUX instances ChapCam tournent (double-clic,
// ancienne version restee ouverte, etc.), il existe deux fenetres avec le
// meme titre/classe/exe et OBS peut matcher la fenetre INVISIBLE -> capture
// vide -> logo OBS dans l'appel video. On impose une seule instance : toute
// seconde tentative se contente de ramener la fenetre existante au premier
// plan au lieu de creer un doublon.
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
const {
  getVirtualCamera,
  setupVirtualCameraIPC,
  launchObs,
  CHAPCAM_WINDOW_TITLE,
} = require('./virtual-camera')
const { getVoiceSwap, setupVoiceSwapIPC } = require('./voice-swap')

// Resolution/cadence de sortie de la camera virtuelle
const VCAM = { width: 1280, height: 720, fps: 30 }

// Set app user model ID for Windows (must be called early)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chapcam.desktop')
}

let mainWindow
let splashWindow
let tray
let nextServer
// Compteur de redemarrages consecutifs du serveur Next (anti boucle infinie)
let nextServerRestartAttempts = 0

const isDev = process.env.NODE_ENV === 'development'
const PORT = 3000

// Debug logging
// IMPORTANT : log() ecrit AUSSI dans le journal de diagnostic (fichier
// chapcam-debug.log). Sans cela, les logs du processus principal (demarrage
// du serveur Next, relances, rechargements de fenetre, did-fail-load) partent
// sur stdout et sont INVISIBLES dans le journal — impossible de diagnostiquer
// un ecran noir ou un rechargement intempestif.
function log(message) {
  console.log(`[ChapCam] ${message}`)
  try {
    writeDebugLog(`[${new Date().toISOString()}] [main] [ChapCam] ${message}`)
  } catch (_) {}
}

// ---- JOURNAL DE DIAGNOSTIC (fix ecran noir) -------------------------------
// L'app packagee n'a pas de console facilement accessible pour l'utilisateur.
// On capture TOUS les console.log du renderer (les logs [Lucy 2.1], [Next.js],
// [live-swap]...) et on les ecrit dans un fichier local. Un bouton
// "Diagnostic" dans la page Live Swap les copie dans le presse-papiers, ce qui
// permet de diagnostiquer un ecran noir sans DevTools.
let debugLogPath = null
let debugLogFd = null
function initDebugLog() {
  try {
    const dir = app.getPath('userData')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    debugLogPath = path.join(dir, 'chapcam-debug.log')
    debugLogFd = fs.openSync(debugLogPath, 'a')
    // Tronquer si le fichier depasse 2 Mo (rotation simple)
    try {
      const stat = fs.statSync(debugLogPath)
      if (stat.size > 2 * 1024 * 1024) {
        fs.truncateSync(debugLogPath, 0)
      }
    } catch (_) {}
    log(`Journal de diagnostic: ${debugLogPath}`)
  } catch (e) {
    log(`Erreur init journal diagnostic: ${e.message}`)
  }
}
function writeDebugLog(line) {
  try {
    if (debugLogFd) fs.writeSync(debugLogFd, line + '\n')
  } catch (_) {}
}
function clearDebugLogFile() {
  try {
    if (debugLogFd) {
      fs.closeSync(debugLogFd)
      debugLogFd = null
    }
    if (debugLogPath && fs.existsSync(debugLogPath)) fs.unlinkSync(debugLogPath)
    initDebugLog()
  } catch (_) {}
}

// ---- CAPTURE DES CRASH / EXCEPTIONS (diagnostic ecran noir) ---------------
// Toute exception non geree du processus principal tue l'app SANS aucun log
// (c'est exactement ce qui s'est passe : "Page leave detected" puis silence
// total au demarrage OBS). On capture tout ce qui peut tuer le main pour
// pouvoir le voir dans chapcam-debug.log au prochain incident.
process.on('uncaughtException', (err) => {
  try {
    writeDebugLog(`[${new Date().toISOString()}] [main] [FATAL] uncaughtException: ${err && err.stack ? err.stack : String(err)}`)
  } catch (_) {}
  console.error('[ChapCam] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  try {
    writeDebugLog(`[${new Date().toISOString()}] [main] [FATAL] unhandledRejection: ${reason && reason.stack ? reason.stack : String(reason)}`)
  } catch (_) {}
  console.error('[ChapCam] unhandledRejection:', reason)
})

// Create splash screen
function createSplashScreen() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const splashHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0a0e1a 0%, #1a1f35 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          overflow: hidden;
          border-radius: 20px;
          border: 1px solid rgba(0, 255, 136, 0.3);
        }
        .container {
          text-align: center;
          position: relative;
        }
        .logo {
          font-size: 64px;
          font-weight: 900;
          background: linear-gradient(135deg, #00ff88 0%, #00d4ff 50%, #e91e8c 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 10px;
          animation: glow 2s ease-in-out infinite alternate;
        }
        .subtitle {
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 40px;
        }
        .loader {
          width: 200px;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          margin: 0 auto;
        }
        .loader-bar {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg, #00ff88, #00d4ff, #e91e8c);
          border-radius: 4px;
          animation: loading 2s ease-in-out forwards;
        }
        .status {
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          margin-top: 20px;
        }
        .glow-circle {
          position: absolute;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(0, 255, 136, 0.15) 0%, transparent 70%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: -1;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes glow {
          from { filter: drop-shadow(0 0 20px rgba(0, 255, 136, 0.5)); }
          to { filter: drop-shadow(0 0 40px rgba(0, 212, 255, 0.8)); }
        }
        @keyframes loading {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
        @keyframes pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
          50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.8; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="glow-circle"></div>
        <div class="logo">ChapCam</div>
        <div class="subtitle">Face Swap en Temps Reel</div>
        <div class="loader"><div class="loader-bar"></div></div>
        <div class="status">Chargement...</div>
      </div>
    </body>
    </html>
  `

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHTML)}`)
  log('Splash screen created')
}

// Create the main application window
function createWindow() {
  // Get icon path
  const iconPath = getIconPath()
  log(`Using icon: ${iconPath}`)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: CHAPCAM_WINDOW_TITLE,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: !isDev,
      devTools: true,
      // Ne JAMAIS geler la page en arriere-plan : Chromium peut "freezer" une
      // page cachee (Page Lifecycle API) et livekit ecoute l'evenement
      // 'freeze' -> il se deconnecte -> "Page leave detected" -> session
      // live swap tuee alors que l'utilisateur est juste passe sur une autre
      // fenetre ou que Windows a reduit l'activite.
      backgroundThrottling: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0e1a',
    show: false
  })

  // Load the app
  loadApp()

  // Titre de fenetre STABLE : la scene OBS "ChapCam" capture la fenetre par
  // son titre (string Titre:Classe:Exe). Si le HTML (Next.js) changeait le
  // titre a chaque navigation, OBS perdrait la fenetre capturée. On fige le
  // titre du BrowserWindow pour que la capture soit toujours fiable.
  mainWindow.on('page-title-updated', (e) => e.preventDefault())
  mainWindow.setTitle(CHAPCAM_WINDOW_TITLE)

  // La capture OBS (WGC) ne peut PAS capturer une fenetre MINIMISEE : si
  // l'utilisateur minimise ChapCam pendant l'appel video (pour voir WhatsApp
  // en plein ecran), le flux OBS devient noir et l'interlocuteur voit le
  // logo OBS / camera barree. Tant que la camera virtuelle OBS est active, on
  // restaure automatiquement la fenetre (l'avatar doit rester visible).
  //
  // On garde l'evenement 'minimize' pour une restauration IMMEDIATE, et on
  // ajoute une surveillance periodique (setInterval) : une fenetre minimisee
  // AVANT le demarrage du swap (l'utilisateur minimise ChapCam, puis clique
  // "Demarrer le Live Swap") ne declenche plus l'evenement 'minimize' au bon
  // moment — seul le polling la rattrape et la restaure.
  mainWindow.on('minimize', () => {
    try {
      const vc = getVirtualCamera()
      if (vc.isRunning && vc.mode === 'obs') {
        setTimeout(() => {
          if (
            mainWindow &&
            !mainWindow.isDestroyed() &&
            mainWindow.isMinimized() &&
            getVirtualCamera().isRunning
          ) {
            mainWindow.restore()
            log('Fenetre ChapCam restauree (minimisee pendant la diffusion)')
          }
        }, 500)
      }
    } catch (e) {
      log(`Restore apres minimize: ${e.message}`)
    }
  })

  // Surveillance continue : tant qu'OBS diffuse la fenetre ChapCam, on
  // verifie toutes les 1.5s que la fenetre n'est pas minimisee et on la
  // restaure sinon. Ne fait RIEN quand la camera virtuelle est arretee ou en
  // mode pilote (pas de capture de fenetre -> la minimisation est permise).
  const obsWindowWatchdog = setInterval(() => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const vc = getVirtualCamera()
      if (!vc.isRunning || vc.mode !== 'obs') return
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
        log('Fenetre ChapCam restauree par la surveillance OBS')
      }
    } catch (e) {
      log(`Watchdog fenetre: ${e.message}`)
    }
  }, 1500)
  mainWindow.on('closed', () => clearInterval(obsWindowWatchdog))

  // Voice Swap : relier la fenetre au service pour les push d'etat (latence,
  // sante connexion, buffering) vers l'UI web.
  try {
    getVoiceSwap().attachWindow(mainWindow)
  } catch (e) {
    log(`Voice Swap attach error: ${e.message}`)
  }

  // Show DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // Handle window events
  mainWindow.webContents.on('did-finish-load', () => {
    log('Content loaded successfully')
    showMainWindow()
  })

  // Capturer tous les logs du renderer vers le journal de diagnostic (ecran
  // noir : permet de voir l'etat reel de la connexion Decart/LiveKit sans
  // DevTools).
  //
  // IMPORTANT (Electron >= 30) : la signature historique
  // (event, level, message, line, sourceId) a ete RETIREE. Les proprietes
  // (level, message, lineNumber, sourceId) sont portees par l'objet event.
  // On lit donc l'objet event en priorite, avec repli sur les args positionnels
  // pour les anciennes versions d'Electron.
  mainWindow.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
    try {
      const ts = new Date().toISOString()
      const level =
        typeof event?.level === 'number' || typeof event?.level === 'string'
          ? event.level
          : legacyLevel
      const message =
        typeof event?.message === 'string' ? event.message : legacyMessage
      writeDebugLog(`[${ts}] [${level}] ${message}`)
    } catch (_) {}
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // IMPORTANT : ce handler se declenche pour CHAQUE frame, y compris les
    // ressources secondaires (image, script, favicon, font). Sans le filtre
    // isMainFrame, l'echec d'une simple ressource rechargeait TOUTE la page
    // vers l'URL de la ressource cassee -> boucle de rechargements -> ecran
    // noir, et chaque rechargement tuait la session live swap en cours
    // ("Page leave detected" de livekit). On ne reagit qu'aux echecs de la
    // frame principale.
    if (!event.isMainFrame) return
    log(`Failed to load (main frame): ${errorDescription} (${errorCode}) - URL: ${validatedURL}`)
    // Ne plus basculer sur la page d'erreur "recharger" : l'app est 100%
    // locale (localhost) et le serveur tourne. On retente le chargement de la
    // PAGE (pas de validatedURL, qui peut etre une ressource cassee) avec un
    // delai, sans boucle infinie.
    if (!app.isQuitting && validatedURL && validatedURL.startsWith(`http://localhost:${PORT}`)) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(`http://localhost:${PORT}/dashboard/live-swap`).catch(() => {})
        }
      }, 800)
    }
  })

  // Crash du renderer : la version moderne d'Electron utilise
  // 'render-process-gone' (avec la raison exacte : oom, crashed, killed...) au
  // lieu de l'ancien 'crashed'. On ecoute les DEUX pour etre sur de capter le
  // crash dans le journal.
  mainWindow.webContents.on('crashed', () => {
    log('Renderer process crashed (crashed)')
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer process gone: reason=${details && details.reason} exitCode=${details && details.exitCode} (diagnostic)`)
  })
  mainWindow.webContents.on('unresponsive', () => {
    log('Renderer process unresponsive')
  })
  mainWindow.webContents.on('gpu-process-crashed', (_event, killed) => {
    log(`GPU process crashed (killed=${killed})`)
  })

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Create application menu
  createMenu()
}

// Get the correct icon path based on platform
function getIconPath() {
  // For Windows, try .ico first, then fall back to .jpg
  // For other platforms, use .jpg
  const iconNames = process.platform === 'win32' 
    ? ['icon.ico', 'icon-512.jpg', 'icon.jpg'] 
    : ['icon.jpg', 'icon-512.jpg']
  
  // Try multiple paths with multiple icon names
  const basePaths = [
    path.join(__dirname, '../public/icons'),
    path.join(process.resourcesPath || '', 'public/icons'),
    path.join(app.getAppPath(), 'public/icons'),
    path.join(__dirname, '..', 'public', 'icons')
  ]

  for (const basePath of basePaths) {
    for (const iconName of iconNames) {
      const fullPath = path.join(basePath, iconName)
      if (fs.existsSync(fullPath)) {
        log(`Found icon at: ${fullPath}`)
        return fullPath
      }
    }
  }

  // Ultimate fallback
  const fallback = path.join(__dirname, '../public/icons/icon.jpg')
  log(`Using fallback icon: ${fallback}`)
  return fallback
}

// Load the application
function loadApp() {
  // En dev comme en production, on charge le serveur Next embarqué localement
  // (http://localhost:PORT). La version packagée NE dépend PLUS de chapcam.com :
  // le build .next + node_modules sont empaquetés dans l'app, ce qui permet le
  // mode gratuit illimité local (lib/free-mode.ts) sans dépendre du site distant.
  //
  // On ouvre DIRECTEMENT le studio Live Swap (/dashboard/live-swap) au lancement
  // et non la page marketing (/), qui est sombre (#0a0e1a) : OBS capture la
  // fenêtre et l'envoie à WhatsApp — sans ça, WhatsApp voit un écran noir tant
  // que l'utilisateur n'a pas navigué manuellement jusqu'au studio. Si la
  // session n'est pas active, le proxy (proxy.ts, ex-middleware) redirige
  // vers /auth/login (une seule connexion nécessaire, la session persiste ensuite).
  const appUrl = `http://localhost:${PORT}/dashboard/live-swap`
  log(`Loading app URL: ${appUrl}`)
  mainWindow.loadURL(appUrl)
}

// Load fallback page when main content fails
function loadFallbackPage() {
  const fallbackHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>ChapCam - Erreur de chargement</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0a0e1a 0%, #1a1f35 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          color: white;
        }
        .container { text-align: center; padding: 40px; }
        .logo {
          font-size: 48px;
          font-weight: 900;
          background: linear-gradient(135deg, #00ff88 0%, #00d4ff 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 20px;
        }
        h1 { font-size: 24px; margin-bottom: 10px; color: #fff; }
        p { color: rgba(255,255,255,0.6); margin-bottom: 30px; }
        .btn {
          display: inline-block;
          padding: 12px 30px;
          background: linear-gradient(135deg, #00ff88, #00d4ff);
          color: #000;
          text-decoration: none;
          border-radius: 30px;
          font-weight: 600;
          margin: 5px;
          cursor: pointer;
          border: none;
          font-size: 14px;
        }
        .btn:hover { transform: scale(1.05); }
        .btn-secondary {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.3);
          color: white;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">ChapCam</div>
        <h1>Impossible de charger l'application</h1>
        <p>Verifiez votre connexion internet ou reessayez.</p>
        <button class="btn" onclick="location.reload()">Reessayer</button>
        <button class="btn btn-secondary" onclick="window.location.href='https://chapcam.com'">Ouvrir le site web</button>
      </div>
    </body>
    </html>
  `

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHTML)}`)
  showMainWindow()
}

// Show main window and close splash
function showMainWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
  }
  
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    
    // Request camera permissions on macOS
    if (process.platform === 'darwin') {
      requestCameraAccess()
    }
  }
}

// Request camera access on macOS
async function requestCameraAccess() {
  if (process.platform === 'darwin') {
    try {
      const cameraStatus = systemPreferences.getMediaAccessStatus('camera')
      
      if (cameraStatus !== 'granted') {
        const granted = await systemPreferences.askForMediaAccess('camera')
        log(`Camera access: ${granted ? 'granted' : 'denied'}`)
      }
      
      const micStatus = systemPreferences.getMediaAccessStatus('microphone')
      if (micStatus !== 'granted') {
        await systemPreferences.askForMediaAccess('microphone')
      }
    } catch (error) {
      log(`Error requesting camera access: ${error.message}`)
    }
  }
}

// Create system tray
function createTray() {
  const iconPath = path.join(__dirname, '../public/icons/tray-icon.jpg')
  
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } catch (e) {
    log(`Tray icon error: ${e.message}`)
    return
  }
  
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Ouvrir ChapCam', 
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    { 
      label: 'Camera Virtuelle', 
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        toggleVirtualCamera(menuItem.checked)
      }
    },
    { type: 'separator' },
    { 
      label: 'Quitter', 
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])
  
  tray.setToolTip('ChapCam - Face Swap en Temps Reel')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'ChapCam',
      submenu: [
        { label: 'A propos de ChapCam', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: () => openPreferences() },
        { type: 'separator' },
        { label: 'Masquer ChapCam', role: 'hide' },
        { label: 'Masquer les autres', role: 'hideOthers' },
        { label: 'Tout afficher', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit() } }
      ]
    },
    {
      label: 'Edition',
      submenu: [
        { label: 'Annuler', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Retablir', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copier', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Coller', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Tout selectionner', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: 'Forcer le rechargement', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Outils de developpement', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Plein ecran', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Zoom avant', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom arriere', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Taille reelle', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' }
      ]
    },
    {
      label: 'Camera',
      submenu: [
        {
          label: 'Lancer OBS Studio',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            launchObs().then((r) => {
              if (r && r.error) log(`Lancer OBS: ${r.error}`)
              pushVcamState(getVirtualCamera().getStatus())
            })
          }
        },
        { type: 'separator' },
        {
          label: 'Activer Camera Virtuelle',
          accelerator: 'CmdOrCtrl+Shift+V',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => toggleVirtualCamera(menuItem.checked)
        },
        { type: 'separator' },
        { label: 'Parametres Camera...', click: () => openCameraSettings() }
      ]
    },
    {
      label: 'Fenetre',
      submenu: [
        { label: 'Minimiser', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Fermer', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://chapcam.com/docs') },
        { label: 'Support', click: () => shell.openExternal('https://t.me/chapcam1') },
        { type: 'separator' },
        { label: 'Signaler un probleme...', click: () => shell.openExternal('https://t.me/chapcam1') }
      ]
    }
  ]
  
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Toggle virtual camera : (de)marre la diffusion (OBS Virtual Camera en
// priorite, pilote akvirtualcamera en fallback) + la capture du renderer
// UNIQUEMENT en mode pilote (en mode OBS, OBS capture la fenetre lui-meme).
async function toggleVirtualCamera(enabled) {
  const vc = getVirtualCamera()
  try {
    if (enabled) {
      const status = await vc.start(VCAM)
      // En mode pilote uniquement : demarrer la capture du canvas transforme
      // cote page web. En mode OBS, inutile (OBS capture la fenetre).
      if (status.mode !== 'obs') {
        if (mainWindow) mainWindow.webContents.send('vcam:start', VCAM)
      }
      pushVcamState(status)
    } else {
      if (mainWindow) mainWindow.webContents.send('vcam:stop')
      const status = vc.stop()
      pushVcamState(status)
    }
  } catch (e) {
    log(`Virtual camera error: ${e.message}`)
    pushVcamState(vc.getStatus())
    if (mainWindow) {
      mainWindow.webContents.send('virtual-camera-toggle', false)
    }
  }
  // Compat : notifier aussi l'ancien canal d'evenement
  if (mainWindow) mainWindow.webContents.send('virtual-camera-toggle', enabled)
  log(`Virtual camera: ${enabled ? 'enabled' : 'disabled'}`)
}

// Pousse l'etat de la camera virtuelle vers l'UI web
function pushVcamState(state) {
  if (mainWindow) mainWindow.webContents.send('virtual-camera-state', state)
}

// Open preferences
function openPreferences() {
  if (mainWindow) {
    mainWindow.webContents.send('open-preferences')
  }
}

// Open camera settings
function openCameraSettings() {
  if (mainWindow) {
    mainWindow.webContents.send('open-camera-settings')
  }
}

// IPC Handlers
ipcMain.handle('get-camera-access', async () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('camera')
  }
  return 'granted'
})

ipcMain.handle('request-camera-access', async () => {
  await requestCameraAccess()
  return systemPreferences.getMediaAccessStatus('camera')
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-platform', () => {
  return process.platform
})

// Journal de diagnostic : recuperer / vider les logs captures (bouton
// "Diagnostic" de la page Live Swap).
ipcMain.handle('get-debug-log', () => {
  try {
    if (debugLogPath && fs.existsSync(debugLogPath)) {
      const txt = fs.readFileSync(debugLogPath, 'utf8')
      // Garder les 400 dernieres lignes (le fichier peut etre gros)
      const lines = txt.split(/\r?\n/)
      return lines.slice(-400).join('\n')
    }
  } catch (_) {}
  return ''
})
ipcMain.handle('clear-debug-log', () => {
  clearDebugLogFile()
  return true
})

// Start Next.js dev server in development
function startNextServer() {
  if (isDev) {
    log('Starting Next.js dev server...')
    // Lancement DIRECT de `next dev -p 3000` (et non `npm run dev` ->
    // scripts/dev.mjs qui auto-incremente le port). Si le port etait occupe,
    // dev.mjs choisissait 3001 tandis que la fenetre charge localhost:3000 :
    // l'app affichait la page d'erreur. Ici le port est garanti = PORT.
    const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next')
    nextServer = spawn(
      process.execPath,
      [nextBin, 'dev', '-p', String(PORT)],
      {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'pipe'
      }
    )
    
    nextServer.stdout.on('data', (data) => {
      const txt = String(data).trim()
      if (!txt) return
      console.log(`[Next.js] ${txt}`)
      writeDebugLog(`[${new Date().toISOString()}] [next] ${txt}`)
    })
    
    nextServer.stderr.on('data', (data) => {
      const txt = String(data).trim()
      if (!txt) return
      console.error(`[Next.js Error] ${txt}`)
      writeDebugLog(`[${new Date().toISOString()}] [next-error] ${txt}`)
    })
    watchNextServer()
    return
  }

  // Production : servir le build Next empaqueté (next start sur localhost:PORT).
  // L'app de bureau devient autonome : pas de dépendance à chapcam.com, et le
  // mode gratuit local (lib/free-mode.ts) s'applique.
  log(`Starting Next.js production server on port ${PORT}...`)
  // next start exige un dossier REEL en cwd (stdlib + caches + .next). Depuis
  // electron-builder, node_modules/.next/public sont descar en app.asar.unpacked.
  // On remplace le suffixe .asar par .asar.unpacked pour retrouver ce dossier ;
  // en dev (pas d'asar) on reste sur le dossier du projet.
  const __dirnameReal = __dirname.includes('.asar')
    ? __dirname.replace('.asar', '.asar.unpacked')
    : __dirname
  const cwd = path.join(__dirnameReal, '..')
  // next.cmd (Windows) est requis pour exécuter le CLI ; on préfère passer par
  // le binaire JS directement pour éviter les soucis de shell.
  const nextBin = path.join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next')
  nextServer = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    cwd,
    // ELECTRON_RUN_AS_NODE : fait tourner l'exe Electron comme un binaire Node
    // pur, indispensable pour exécuter le CLI Next dans l'app packagée.
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe'
  })

  nextServer.stdout.on('data', (data) => {
    const txt = String(data).trim()
    if (!txt) return
    console.log(`[Next.js] ${txt}`)
    writeDebugLog(`[${new Date().toISOString()}] [next] ${txt}`)
  })

  nextServer.stderr.on('data', (data) => {
    const txt = String(data).trim()
    if (!txt) return
    console.error(`[Next.js Error] ${txt}`)
    writeDebugLog(`[${new Date().toISOString()}] [next-error] ${txt}`)
  })

  // Relance automatique du serveur Next s'il meurt (crash, OOM, veille
  // Windows...). SANS ce garde-fou, l'app continue de tourner (le renderer
  // garde la page en memoire et le tracking Supabase externe fonctionne) mais
  // TOUT fetch vers l'API locale (/api/live/access, /api/points...) echoue
  // avec "TypeError: Failed to fetch" -> le bouton "Demarrer le live swap"
  // affiche "Impossible de verifier l'acces".
  watchNextServer()
}

// Surveille la vie du serveur Next et le relance s'il meurt.
// Backoff exponentiel (2s, 4s, 8s, 16s) plafonne a 60s, puis abandon apres
// 10 tentatives pour ne pas boucler indefiniment si le port est vraiment pris.
function watchNextServer() {
  if (!nextServer) return
  nextServer.on('exit', (code, signal) => {
    if (app.isQuitting) return
    nextServerRestartAttempts++
    if (nextServerRestartAttempts > 10) {
      log(`Serveur Next abandonne apres ${nextServerRestartAttempts} relances (code=${code}, signal=${signal})`)
      return
    }
    const delay = Math.min(2000 * Math.pow(2, nextServerRestartAttempts - 1), 60000)
    log(`Serveur Next arrete (code=${code}, signal=${signal}) — relance dans ${delay}ms (tentative ${nextServerRestartAttempts})`)
    setTimeout(() => {
      if (app.isQuitting) return
      startNextServer()
      // Recharger la fenetre : le renderer avait la page en memoire avec une
      // API morte ; il faut refaire le tour (auth + fetch /api/*) pour que le
      // live swap retrouve son backend.
      if (mainWindow && !mainWindow.isDestroyed()) {
        log('Rechargement de la fenetre apres relance du serveur Next')
        mainWindow.loadURL(`http://localhost:${PORT}/dashboard/live-swap`).catch(() => {})
      }
    }, delay)
  })
}

// Attend que le serveur Next reponde sur localhost:PORT (au lieu d'un delai
// fixe). Sans cette attente, la fenetre se cree trop tot, le chargement echoue
// et l'utilisateur voit la page d'erreur "recharger". La verification est
// legerement tolerante : HTTP 200 comme les erreurs de routes (le serveur
// tourne) comptent comme "pret".
function waitForNextServer(timeoutMs = 60000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const http = require('http')
    const check = () => {
      const req = http.get(
        { host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 },
        (res) => {
          res.resume()
          // Le serveur repond : reinitialiser le compteur de relances (les
          // redemarrages precedents ont abouti).
          nextServerRestartAttempts = 0
          resolve(true)
        },
      )
      req.on('timeout', () => {
        req.destroy()
        retry()
      })
      req.on('error', () => retry())
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        log(`Serveur Next non pret apres ${timeoutMs}ms`)
        resolve(false)
        return
      }
      setTimeout(check, 500)
    }
    check()
  })
}

// App lifecycle
app.whenReady().then(() => {
  log('App ready')
  initDebugLog()

  // ---- FIX CORS SUPABASE (login/inscription "Failed to fetch") ------------
  // L'app charge l'UI depuis http://localhost:3000 (serveur Next embarque).
  // supabase-js (gotrue) envoie credentials:'include' sur /auth/v1/*. Or
  // Supabase repond Access-Control-Allow-Origin:* sans Allow-Credentials, ce
  // que Chromium refuse pour une requete cross-origin avec credentials -> le
  // fetch echoue "Failed to fetch" et l'utilisateur ne peut ni se connecter ni
  // s'inscrire. On patche les reponses Supabase pour refleter l'origin locale
  // exacte + autoriser les credentials (et re-attacher les headers CORS deja
  // fournis par le serveur). L'app reste une app de bureau locale : seules les
  // reponses de *.supabase.co sont modifiees, aucune restriction de securite
  // globale n'est desactivee.
  const supabaseOrigin = `http://localhost:${PORT}`
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const url = details.url || ''
      if (url.includes('.supabase.co')) {
        // FIX CORS double-valeur : Supabase renvoie deja Access-Control-Allow-Origin
        // (et Allow-Credentials) avec SES valeurs (ex: "*", en minuscules ou non).
        // Un simple Object.assign les garde A COTE des notres -> le header final
        // contient deux valeurs (ex: "*, http://localhost:3000") que Chromium
        // refuse -> login/inscription echouent en "Failed to fetch". On retire
        // donc TOUTES les entrees CORS existantes (insensible a la casse) avant
        // de poser nos valeurs.
        const raw = details.responseHeaders || {}
        const drop = new Set(['access-control-allow-origin', 'access-control-allow-credentials'])
        const h = {}
        for (const key of Object.keys(raw)) {
          if (drop.has(key.toLowerCase())) continue
          h[key] = raw[key]
        }
        h['Access-Control-Allow-Origin'] = [supabaseOrigin]
        h['Access-Control-Allow-Credentials'] = ['true']
        if (!h['Access-Control-Allow-Headers']) h['Access-Control-Allow-Headers'] = ['apikey, authorization, content-type']
        if (!h['Access-Control-Allow-Methods']) h['Access-Control-Allow-Methods'] = ['GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS']
        if (!h['Access-Control-Expose-Headers']) h['Access-Control-Expose-Headers'] = ['x-supabase-api-version']
        callback({ responseHeaders: h })
        return
      }
    } catch (e) {
      log(`CORS patch error: ${e.message}`)
    }
    callback({ responseHeaders: details.responseHeaders })
  })
  log('CORS patch Supabase active (login/inscription)')

  // Enregistrer les handlers IPC de la camera virtuelle
  setupVirtualCameraIPC()

  // Enregistrer les handlers IPC de Voice Swap (architecture/scaffolding)
  setupVoiceSwapIPC()

  // Show splash screen first
  createSplashScreen()

  // Démarrer le serveur Next (dev ou prod) : l'app est autonome et charge
  // http://localhost:PORT. En prod, next start sert le build .next empaqueté.
  startNextServer()

  // Creer la fenetre UNE FOIS le serveur pret (evite la page d'erreur).
  waitForNextServer().then((ready) => {
    if (ready) {
      createWindow()
    } else {
      // Dernier recours : tenter quand meme (le serveur peut demarrer juste apres).
      createWindow()
    }
  })

  createTray()
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true

  // Couper proprement la camera virtuelle
  try {
    getVirtualCamera().stop()
  } catch (_) {}

  // Couper proprement la session Voice Swap
  try {
    getVoiceSwap().stop()
  } catch (_) {}

  if (nextServer) {
    nextServer.kill()
  }
})

// Handle certificate errors for development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault()
    callback(true)
  } else {
    callback(false)
  }
})

// Set app user model ID for Windows
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chapcam.desktop')
  
  // Also set the icon explicitly for the taskbar
  const iconPath = path.join(__dirname, '../public/icons/icon-512.jpg')
  if (fs.existsSync(iconPath)) {
    app.setAsDefaultProtocolClient('chapcam')
  }
}

log('Main process initialized')
