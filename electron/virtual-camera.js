/**
 * Camera virtuelle ChapCam Desktop
 * ----------------------------------
 * Deux chemins de diffusion possibles (Windows) :
 *
 * 1) CHEMIN PRINCIPAL : OBS Virtual Camera.
 *    OBS Studio capture la fenetre ChapCam (source "Capture de fenetre") et
 *    expose le flux via sa propre camera virtuelle. WhatsApp/Zoom/Teams/Meet
 *    selectionnent alors "OBS Virtual Camera". C'est le chemin recommande car
 *    il fonctionne partout sans pilote systeme (et c'est celui qui marche sur
 *    les machines de nos utilisateurs).
 *
 * 2) FALLBACK : pilote akvirtualcamera embarque ("ChapCam Camera").
 *    Cree un VRAI peripherique camera systeme nomme "ChapCam Camera" et lui
 *    pousse, image par image, la sortie face-swap deja transformee :
 *      renderer (capture du canvas) --IPC--> main --stdin--> AkVCamManager
 *      --> pilote "ChapCam Camera" --> applications tierces.
 *
 * La detection OBS est faite via tasklist (obs64.exe). L'app peut aussi
 * LANCER OBS avec --startvirtualcam (demarrage auto de la Virtual Camera).
 */

const { ipcMain, BrowserWindow, app } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn, execFile, spawnSync } = require('child_process')

// ---- Identite du peripherique (ce que verront OBS/Zoom/Teams/etc.) ----
const DEVICE_DESCRIPTION = 'ChapCam Camera'
const DEVICE_ID = 'ChapCamCamera' // id interne stable pour akvirtualcamera

// ---- Format de sortie ----
const DEFAULT = { width: 1280, height: 720, fps: 30 }

// Reglages couleur/orientation (a ajuster si rendu errone au 1er test Windows) :
//   - SWAP_RB : echange Rouge/Bleu (RGBA navigateur -> BGR DirectShow)
//   - FLIP_V  : retourne verticalement (DShow attend souvent bottom-up)
const SWAP_RB = true
const FLIP_V = true

// IMPORTANT : log() ecrit AUSSI dans le fichier de diagnostic chapcam-debug.log
// (le meme que main.js). Sans cela, les logs du lancement OBS / du demarrage
// pilote sont INVISIBLES dans le journal — impossible de diagnostiquer un
// crash au moment ou OBS demarre ("Page leave detected" + plus aucun log).
let _debugLogPath = null
function debugLogFilePath() {
  try {
    if (_debugLogPath) return _debugLogPath
    const dir = app.getPath('userData')
    _debugLogPath = path.join(dir, 'chapcam-debug.log')
  } catch (_) {}
  return _debugLogPath
}
function log(msg) {
  console.log(`[VirtualCamera] ${msg}`)
  try {
    const p = debugLogFilePath()
    if (p) fs.appendFileSync(p, `[${new Date().toISOString()}] [vcam] [VirtualCamera] ${msg}\n`)
  } catch (_) {}
}

// Detecte si OBS Studio tourne (obs64.exe). C'est le chemin de diffusion
// PRINCIPAL : OBS capture la fenetre ChapCam et expose sa "Virtual Camera".
//
// Detection SANS cache (pour killObs/waitForObsRunning qui scrutent l'arret
// reel d'OBS en boucle rapprochee) et detection CACHEE 5s (pour getStatus,
// appele souvent sans lancer tasklist a chaque fois).
let _obsCheck = { value: false, at: 0 }
function detectObsRunning() {
  if (process.platform !== 'win32') return false
  try {
    const out = spawnSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq obs64.exe'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 },
    )
    return /obs64\.exe/i.test(out.stdout || '')
  } catch (e) {
    return false
  }
}
function isObsBridgeRunning() {
  const now = Date.now()
  if (now - _obsCheck.at < 5000) return _obsCheck.value
  const running = detectObsRunning()
  _obsCheck = { value: running, at: now }
  return running
}

// Ferme OBS et attend sa disparition. Necessaire quand OBS tourne DEJA avec
// une scene perimee : une instance ouverte garde sa scene en memoire (l'ancien
// window string vers electron.exe de dev) et ne recharge jamais ChapCam.json
// ecrit a cote. Le seul moyen fiable est de redemarrer OBS pour qu'il relise
// la scene a jour.
//
// Arret POLI d'abord (taskkill sans /F -> WM_CLOSE, OBS sauvegarde ses
// scenes/profil), puis /F en secours apres 3s. On n'ecrase jamais l'etat de
// l'utilisateur (ses scenes perso restent sauvegardees par OBS lui-meme).
// Retourne une Promise resolue quand obs64.exe a disparu (ou au timeout).
function killObs(timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (!detectObsRunning()) {
      clearObsCrashSentinels()
      resolve()
      return
    }
    // 1. Arret propre (WM_CLOSE) : OBS peut sauvegarder sa config. On attend
    // jusqu'a 10s : sur les machines lentes (6 Go de RAM, disque HDD), OBS
    // met parfois plus de 3s a se fermer proprement. Le tuer au bout de 3s
    // le marquait systematiquement en "unclean shutdown" -> dialogue de crash
    // au demarrage suivant.
    try {
      spawnSync('taskkill', ['/IM', 'obs64.exe'], {
        windowsHide: true,
        timeout: 8000,
      })
    } catch (_) {}
    const started = Date.now()
    const forceKilled = { value: false }
    const poll = () => {
      if (!detectObsRunning()) {
        // Arret propre : OBS a supprime ses sentinelles lui-meme. On nettoie
        // quand meme par securite.
        clearObsCrashSentinels()
        resolve()
        return
      }
      if (Date.now() - started > 10000 && !forceKilled.value) {
        // 2. OBS n'a pas repondu a WM_CLOSE : arret force en dernier recours.
        forceKilled.value = true
        try {
          spawnSync('taskkill', ['/IM', 'obs64.exe', '/F'], {
            windowsHide: true,
            timeout: 5000,
          })
        } catch (_) {}
        // Le kill force laisse des sentinelles -> OBS afficherait le dialogue
        // de crash au prochain lancement. On les supprime immediatement.
        clearObsCrashSentinels()
      }
      if (Date.now() - started > timeoutMs) {
        clearObsCrashSentinels()
        log('OBS n\'a pas pu etre arrete dans le delai — relance quand meme')
        resolve()
        return
      }
      setTimeout(poll, 400)
    }
    poll()
  })
}

// Attend (jusqu'a timeoutMs) que obs64.exe tourne. Utilise apres un
// lancement/redemarrage OBS pour ne pas declarer la diffusion active sur un
// process mort.
// IMPORTANT : on poll DETECT obs-running SANS cache (detectObsRunning) :
// apres un kill+relance, le cache 5s d'isObsBridgeRunning garderait l'etat
// "arrete" jusqu'a 5s de plus et waitForObsRunning pourrait conclure a tort
// qu'OBS n'est pas revenu (et basculer sur le pilote en fallback).
function waitForObsRunning(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const poll = () => {
      if (detectObsRunning()) {
        resolve(true)
        return
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(poll, 500)
    }
    poll()
  })
}

// Chemins standard d'installation d'OBS Studio (Windows).
function obsExecutableCandidates() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] || ''
  return [
    path.join(pf, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    path.join(pf86, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    path.join(pf, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    path.join(local, 'Programs', 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    path.join(local, 'obs-studio', 'bin', '64bit', 'obs64.exe'),
  ]
}

// Resout le chemin de obs64.exe s'il est installe (sinon null).
function findObsExecutable() {
  if (process.platform !== 'win32') return null
  for (const c of obsExecutableCandidates()) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch (_) {}
  }
  return null
}

// ============================================================================
// SCENE OBS AUTO-GENEREe "ChapCam"
// ----------------------------------------------------------------------------
// Pour que l'utilisateur n'ait RIEN a configurer dans OBS, l'app ecrit une
// scene collection "ChapCam" dans la config OBS (%APPDATA%/obs-studio) : une
// scene unique avec une source "Capture de fenetre" qui pointe sur la fenetre
// ChapCam, deja selectionnee. OBS est ensuite lance avec --collection ChapCam
// --startvirtualcam : Virtual Camera demarree + scene prete, la fenetre
// ChapCam est capturee automatiquement. Le format copie celui de la scene
// ChapCam_Bridge.json (OBS 32) qui fonctionne sur les machines des users.
// ============================================================================

// Titre de la fenetre ChapCam (fixe dans main.js pour rester stable, sinon
// OBS ne retrouverait plus la fenetre a chaque changement de page).
const CHAPCAM_WINDOW_TITLE = 'LIVECAM - Face Swap en Temps Reel'

// UUID du canvas "default" cree par OBS 32 (identifiant stable, copie depuis
// une scene OBS existante fonctionnelle).
const OBS_DEFAULT_CANVAS_UUID = '6c69626f-6273-4c00-9d88-c5136d61696e'

// Version de format OBS par defaut (32.x) si la version reelle est inconnue.
const OBS_DEFAULT_PREV_VER = 537001985

// Version de FORMAT de la scene ChapCam generee par l'app. A incrementer a
// CHAQUE changement qui exige qu'OBS recharge la scene pour etre pris en
// compte (ex: passage du mode de capture WGC -> bitblt en 1.0.9, passage
// bitblt explicite en 1.0.11). L'app ne reecrit le fichier ChapCam.json que
// si cette version change (marqueur sidecar) : sans ca, chaque lancement
// reecrirait le fichier, le marquerait "modifie" et forcerait un
// redemarrage inutile d'OBS.
const SCENE_VERSION = 5

// Version de format OBS de la machine, lue dans global.ini ([General]
// LastVersion). Utilisee comme prev_ver du JSON de scene : OBS refuse de
// charger une collection marquee "version plus recente" que la sienne, donc
// on annonce toujours la version de l'OBS installe (jamais plus recente).
function obsPrevVer() {
  try {
    const gi = path.join(obsConfigDir(), 'global.ini')
    if (fs.existsSync(gi)) {
      const txt = fs.readFileSync(gi, 'utf8')
      const m = txt.match(/^\s*LastVersion=(\d+)/m)
      if (m && m[1]) return Number(m[1])
    }
  } catch (_) {}
  return OBS_DEFAULT_PREV_VER
}

// Dossier de config OBS (%APPDATA%/obs-studio, ou le chemin [Locations]
// Configuration= de global.ini si l'utilisateur a deplace sa config).
function obsConfigDir() {
  const fallback = path.join(process.env.APPDATA || '', 'obs-studio')
  try {
    const gi = path.join(fallback, 'global.ini')
    if (fs.existsSync(gi)) {
      const txt = fs.readFileSync(gi, 'utf8')
      const m = txt.match(/^\s*Configuration=(.+)$/m)
      if (m && m[1]) {
        const cfg = m[1].trim().replace(/\\\\/g, '\\')
        if (cfg) return path.join(cfg, 'obs-studio')
      }
    }
  } catch (_) {}
  return fallback
}

// Titre REEL de la fenetre ChapCam (celui que Windows/OBS voit), en se
// basant sur la fenetre principale si elle existe, sinon la constante.
function chapCamWindowTitle() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w && !w.isDestroyed()) {
        const t = w.getTitle()
        if (t) {
          log(`DIAG: titre fenetre ChapCam = "${t}"`)
          return t
        }
      }
    }
  } catch (_) {}
  log(`DIAG: aucune fenetre ChapCam trouvee — fallback "${CHAPCAM_WINDOW_TITLE}"`)
  return CHAPCAM_WINDOW_TITLE
}

// Window string OBS cible (Titre:Classe:Exe:), calcule UNE fois et partage
// entre la generation de la scene (buildChapCamSceneCollection) et la
// detection de peremption (ensureObsSceneCollection). Si la fenetre reelle
// (titre, executable) change par rapport a la scene enregistree, la source de
// capture OBS pointe vers une fenetre disparue -> Virtual Camera NOIRE dans
// WhatsApp. On compare ce windowId a chaque lancement pour recréer la source.
function currentChapCamWindowId() {
  return `${chapCamWindowTitle()}:Chrome_WidgetWin_1:${path.basename(process.execPath)}:`
}

// Resolution du canvas OBS courant (profil actif) pour dimensionner la scene.
// Si le profil actif n'a PAS de [Video] (BaseCX/BaseCY absents), on retombe
// sur 1280x720 : c'est la resolution standard que la Virtual Camera doit
// exposer aux apps d'appel video (WhatsApp/Zoom/Teams). Un profil quasi vide
// donnerait une resolution exotique (ex: 1092x614) mal acceptee par ces apps.
const PROFILE_VIDEO_DEFAULTS = { BaseCX: 1280, BaseCY: 720, OutputCX: 1280, OutputCY: 720, FPSType: 1, FPSCommon: 30 }

function obsCanvasSize() {
  try {
    const dir = obsConfigDir()
    const userIni = path.join(dir, 'user.ini')
    if (fs.existsSync(userIni)) {
      const txt = fs.readFileSync(userIni, 'utf8')
      const m = txt.match(/^\s*ProfileDir=(.+)$/m)
      if (m && m[1]) {
        const pini = path.join(dir, 'basic', 'profiles', m[1].trim(), 'basic.ini')
        if (fs.existsSync(pini)) {
          const p = fs.readFileSync(pini, 'utf8')
          const cx = p.match(/^\s*BaseCX=(\d+)/m)
          const cy = p.match(/^\s*BaseCY=(\d+)/m)
          if (cx && cy) return { x: Number(cx[1]), y: Number(cy[1]) }
        }
      }
    }
  } catch (_) {}
  return { x: PROFILE_VIDEO_DEFAULTS.BaseCX, y: PROFILE_VIDEO_DEFAULTS.BaseCY }
}

// Normalise (idempotent) le [Video] du profil OBS actif : ne pose les
// resolutions QUE si la section [Video] est absente ou incomplete (profil
// quasi vide / premiere execution). Ne touche JAMAIS aux reglages existants
// (un utilisateur qui a deja configure son profil garde ses valeurs).
// Retourne true si le profil a ete modifie.
function normalizeObsProfile() {
  try {
    const dir = obsConfigDir()
    const userIni = path.join(dir, 'user.ini')
    if (!fs.existsSync(userIni)) return false
    const txt = fs.readFileSync(userIni, 'utf8')
    const m = txt.match(/^\s*ProfileDir=(.+)$/m)
    if (!m || !m[1]) return false
    const pini = path.join(dir, 'basic', 'profiles', m[1].trim(), 'basic.ini')
    if (!fs.existsSync(pini)) return false
    let p = fs.readFileSync(pini, 'utf8')
    const hasCX = /^\s*BaseCX=\d+/m.test(p)
    const hasCY = /^\s*BaseCY=\d+/m.test(p)
    if (hasCX && hasCY) return false // profil deja configure
    // Backup unique avant modification
    const bak = pini + '.chapcam.bak'
    if (!fs.existsSync(bak)) {
      try { fs.copyFileSync(pini, bak) } catch (_) {}
    }
    // Nettoyer les restes de '\n' litteraux (echappements accidentels)
    p = p.replace(/\\n/g, '\n')
    if (!/^\[Video\]/m.test(p)) p += '\n[Video]\n'
    for (const [k, v] of Object.entries(PROFILE_VIDEO_DEFAULTS)) {
      const re = new RegExp(`^(\\s*${k}=).*$`, 'm')
      if (re.test(p)) {
        p = p.replace(re, `$1${v}`)
      } else {
        p = p.replace(/^(\[Video\][^\[]*)$/m, `$1\n${k}=${v}`)
      }
    }
    fs.writeFileSync(pini, p, 'utf8')
    log(`Profil OBS normalise a 1280x720@30 (${pini})`)
    return true
  } catch (e) {
    log(`Normalisation profil OBS skippee: ${e.message}`)
    return false
  }
}

const _uuid = () => crypto.randomUUID()

// Construit le JSON de la scene collection "ChapCam" (OBS 28-32).
// Le string `window` suit le format OBS : Titre:Classe:Exe:.
//
// IMPORTANT (bug corrige en 1.0.6) : la partie Exe doit etre le NOM DU
// FICHIER uniquement (ex: ChapCam.exe), PAS le chemin complet. OBS splitte
// le window string sur les ':' : avec un chemin complet "C:\Program
// Files\ChapCam\ChapCam.exe", il ne retient que "C" comme executable, ne
// trouve jamais la fenetre, et la Virtual Camera diffuse le logo OBS (icone
// camera barree) dans WhatsApp/Zoom. path.basename() donne exactement ce
// qu'OBS attend, comme lorsqu'on ajoute la source manuellement dans l'UI OBS.
function buildChapCamSceneCollection() {
  const canvas = obsCanvasSize()
  const prevVer = obsPrevVer()
  const winUuid = _uuid()
  const sceneUuid = _uuid()
  const windowId = currentChapCamWindowId()
  log(`DIAG: scene OBS windowId = "${windowId}"`)

  const audioDefaults = {
    prev_ver: prevVer,
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'libobs.mute': [], 'libobs.unmute': [], 'libobs.push-to-mute': [], 'libobs.push-to-talk': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  }

  const sourceDefaults = {
    prev_ver: prevVer,
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'libobs.mute': [], 'libobs.unmute': [], 'libobs.push-to-mute': [], 'libobs.push-to-talk': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  }

  return {
    name: 'ChapCam',
    DesktopAudioDevice1: {
      ...audioDefaults,
      name: 'Audio du bureau',
      uuid: _uuid(),
      id: 'wasapi_output_capture',
      versioned_id: 'wasapi_output_capture',
      settings: { device_id: 'default' },
    },
    AuxAudioDevice1: {
      ...audioDefaults,
      name: 'Mic/Aux',
      uuid: _uuid(),
      id: 'wasapi_input_capture',
      versioned_id: 'wasapi_input_capture',
      settings: { device_id: 'default' },
    },
    sources: [
      {
        ...sourceDefaults,
        name: 'ChapCam window',
        uuid: winUuid,
        id: 'window_capture',
        versioned_id: 'window_capture',
        settings: {
          window: windowId,
          // WGC (mode 2) est plus fiable avec Electron disableHardwareAcceleration
          // (testé 24/08: BitBlt échoue "Failed to create 2D texture 80070057" sur ce PC,
          // WGC passe proprement "method chosen: WGC" + Virtual Camera Start OK).
          // WGC capture via Windows Graphics Capture (compositor), BitBlt via GDI.
          method: 2, // 1 = BitBlt, 2 = WGC, 0 = auto
          capture_mode: 'wgc', // compat OBS 28/29 (chaine)
          cursor: false,
          client_area: true,
          // force l'OSD supprime pour la capture
          priority: 1, // 1 = window match by title priority
        },
      },
      {
        ...sourceDefaults,
        name: 'ChapCam',
        uuid: sceneUuid,
        id: 'scene',
        versioned_id: 'scene',
        mixers: 0,
        hotkeys: {
          'OBSBasic.SelectScene': [],
          'libobs.show_scene_item.2': [],
          'libobs.hide_scene_item.2': [],
        },
        settings: {
          id_counter: 2,
          custom_size: false,
          items: [
            {
              name: 'ChapCam window',
              source_uuid: winUuid,
              visible: true,
              locked: false,
              rot: 0.0,
              scale_ref: { x: canvas.x, y: canvas.y },
              align: 5,
              bounds_type: 2, // Scale-to-window : remplit le canvas
              bounds_align: 5,
              bounds_crop: false,
              crop_left: 0,
              crop_top: 0,
              crop_right: 0,
              crop_bottom: 0,
              id: 2,
              group_item_backup: false,
              pos: { x: 0.0, y: 0.0 },
              pos_rel: { x: 0.0, y: 0.0 },
              scale: { x: 1.0, y: 1.0 },
              scale_rel: { x: 1.0, y: 1.0 },
              bounds: { x: canvas.x, y: canvas.y },
              bounds_rel: { x: 0.0, y: 0.0 },
              scale_filter: 'disable',
              blend_method: 'default',
              blend_type: 'normal',
              show_transition: { duration: 0 },
              hide_transition: { duration: 0 },
              private_settings: {},
            },
          ],
        },
        canvas_uuid: OBS_DEFAULT_CANVAS_UUID,
      },
    ],
    groups: [],
    scene_order: [{ name: 'ChapCam' }],
    current_scene: 'ChapCam',
    current_program_scene: 'ChapCam',
    canvases: [],
    current_transition: 'Fondu',
    transition_duration: 300,
    transitions: [],
    quick_transitions: [
      { name: 'Coupure', duration: 300, hotkeys: [], id: 1, fade_to_black: false },
      { name: 'Fondu', duration: 300, hotkeys: [], id: 2, fade_to_black: false },
      { name: 'Fondu', duration: 300, hotkeys: [], id: 3, fade_to_black: true },
    ],
    saved_projectors: [],
    preview_locked: false,
    scaling_enabled: false,
    scaling_level: -13,
    scaling_off_x: 0.0,
    scaling_off_y: 0.0,
    'virtual-camera': { type2: 3 },
    modules: {
      'scripts-tool': [],
      'output-timer': {
        streamTimerHours: 0, streamTimerMinutes: 0, streamTimerSeconds: 30,
        recordTimerHours: 0, recordTimerMinutes: 0, recordTimerSeconds: 30,
        autoStartStreamTimer: false, autoStartRecordTimer: false, pauseRecordTimer: true,
      },
      'auto-scene-switcher': {
        interval: 300, non_matching_scene: '', switch_if_not_matching: false,
        active: false, switches: [],
      },
      captions: { source: '', enabled: false, lang_id: 1036, provider: 'mssapi' },
    },
    resolution: { x: canvas.x, y: canvas.y },
    version: 2,
  }
}

// Ecrit la scene "ChapCam" dans la config OBS et la selectionne comme
// collection active (avec sauvegarde .bak de user.ini, restauration aisee).
// Retourne { ok, file, error } — n'echoue jamais sur une erreur de config
// (OBS reste lancable sans scene auto, l'utilisateur la cree alors a la main).
function ensureObsSceneCollection(force = false) {
  try {
    const dir = obsConfigDir()
    if (!dir) return { ok: false, error: 'dossier config OBS introuvable' }
    // Normaliser le profil AVANT de generer la scene : obsCanvasSize() lit
    // BaseCX/BaseCY du profil pour dimensionner la scene. Sur un profil
    // quasi vide, on force 1280x720 (resolution standard Virtual Camera).
    normalizeObsProfile()
    const scenesDir = path.join(dir, 'basic', 'scenes')
    fs.mkdirSync(scenesDir, { recursive: true })
    const file = path.join(scenesDir, 'ChapCam.json')
    // Ecrire la scene uniquement si la version de format a change (ou si le
    // fichier n'existe pas). Les UUID generes a chaque buildChapCamSceneCollection
    // rendent une comparaison de contenu impossible : on utilise un marqueur
    // sidecar (ChapCam.scene-version). Cela evite de reecrire le fichier a
    // chaque lancement, ce qui le marquerait "modifie" et declencherait un
    // redemarrage d'OBS inutile (voir obsRunningWithChapCamFlags).
    const markerFile = path.join(scenesDir, 'ChapCam.scene-version')
    const marker = String(SCENE_VERSION)
    let needsWrite =
      force ||
      !fs.existsSync(file) ||
      !fs.existsSync(markerFile) ||
      fs.readFileSync(markerFile, 'utf8').trim() !== marker
    // SOURCE PERIMEE ? Compare la fenetre cible enregistree dans ChapCam.json
    // avec la fenetre ChapCam ACTUELLE (titre + executable). Si elle a change
    // (ex: rebuild, fenetre renommee, exe different), la source de capture OBS
    // pointe vers une fenetre disparue -> Virtual Camera NOIRE dans WhatsApp.
    // On reecrit alors la scene pour recreer la source proprement — c'est le
    // cas ou l'utilisateur doit « supprimer l'ancienne source et en creer une
    // nouvelle », fait automatiquement par l'app.
    if (!needsWrite) {
      try {
        if (fs.existsSync(file)) {
          const existing = JSON.parse(fs.readFileSync(file, 'utf8'))
          const src = existing.sources && existing.sources.find((s) => s && s.id === 'window_capture')
          const existingWindow = src && src.settings && src.settings.window
          const targetWindow = currentChapCamWindowId()
          if (existingWindow && existingWindow !== targetWindow) {
            log(`DIAG: source OBS perimee — "${existingWindow}" -> "${targetWindow}" (recriture de la scene)`)
            needsWrite = true
          }
        }
      } catch (_) {}
    }
    if (needsWrite) {
      const sceneObj = buildChapCamSceneCollection()
      fs.writeFileSync(file, JSON.stringify(sceneObj, null, 4), 'utf8')
      fs.writeFileSync(markerFile, marker, 'utf8')
      log(`Scene OBS "ChapCam" (format v${marker}) ecrite : ${file}`)
      log(`DIAG: resolution scene OBS = ${sceneObj.resolution.x}x${sceneObj.resolution.y}`)
      log(`DIAG: source window capture = "${sceneObj.sources?.[0]?.settings?.window || 'N/D'}"`)
    }

    // Selectionner la collection "ChapCam" comme active dans user.ini
    // UNIQUEMENT si :
    //   - user.ini existe deja (OBS a tourne au moins une fois). On ne cree
    //     jamais un user.ini partiel de zero : cela derouterait le wizard de
    //     premiere execution d'OBS. La scene est chargee via --collection.
    //   - OBS ne tourne pas (s'il tourne, il reecrit user.ini a sa fermeture
    //     et notre modification serait perdue).
    const obsRunning = isObsBridgeRunning()
    const userIni = path.join(dir, 'user.ini')
    if (!obsRunning && fs.existsSync(userIni)) {
      const bak = userIni + '.chapcam.bak'
      if (!fs.existsSync(bak)) {
        try { fs.copyFileSync(userIni, bak) } catch (_) {}
      }
      const ini = fs.readFileSync(userIni, 'utf8')
      // Remplacer ou inserer [Basic] SceneCollection / SceneCollectionFile.
      let iniNext = ini
      const setIni = (key, val) => {
        const re = new RegExp(`^\\s*${key}=.*$`, 'm')
        if (re.test(iniNext)) {
          iniNext = iniNext.replace(re, `${key}=${val}`)
        } else if (/^\[Basic\]/m.test(iniNext)) {
          iniNext = iniNext.replace(/^(\[Basic\][^\[]*)$/m, `$1\n${key}=${val}`)
        } else {
          iniNext += `\n[Basic]\n${key}=${val}\n`
        }
      }
      setIni('SceneCollection', 'ChapCam')
      setIni('SceneCollectionFile', 'ChapCam.json')
      fs.writeFileSync(userIni, iniNext, 'utf8')
    } else {
      log('user.ini non modifie (OBS en cours ou config inexistante) — la scene sera chargee via --collection')
    }

    log(`Scene OBS "ChapCam" prete : ${file}`)
    return { ok: true, file, sceneName: 'ChapCam' }
  } catch (e) {
    log(`Scene OBS auto non creee (l'utilisateur la creera manuellement) : ${e.message}`)
    return { ok: false, error: e.message || String(e) }
  }
}

// ----------------------------------------------------------------------------
// SENTINELLES DE SESSION OBS (dialogue "Crash or unclean shutdown detected")
// ----------------------------------------------------------------------------
// OBS 32 ecrit des fichiers run_<uuid> dans %APPDATA%/obs-studio/.sentinel
// pendant chaque session et les SUPPRIME a l'arret propre. S'ils restent
// (arret force, kill, manque de memoire, arret Windows), OBS affiche au
// demarrage suivant le dialogue "Crash or unclean shutdown detected" et
// reste BLOQUE a attendre une reponse -> la Virtual Camera ne demarre jamais
// -> l'appel video affiche le logo OBS / camera barree. On supprime donc ces
// marqueurs AVANT chaque lancement et apres chaque kill force : le dialogue
// ne peut plus bloquer le demarrage.
function clearObsCrashSentinels() {
  try {
    const dir = path.join(obsConfigDir(), '.sentinel')
    if (!fs.existsSync(dir)) return 0
    let n = 0
    for (const f of fs.readdirSync(dir)) {
      if (/^run_/.test(f)) {
        try {
          fs.unlinkSync(path.join(dir, f))
          n++
        } catch (_) {}
      }
    }
    if (n > 0) log(`Sentinelles de session OBS supprimees (${n}) — dialogue de crash evite`)
    return n
  } catch (_) {
    return 0
  }
}

// OBS tourne-t-il deja AVEC nos parametres (collection ChapCam + virtualcam)
// ET est-il sain (> 100 Mo : un OBS bloque sur un dialogue fait ~2 Mo) ?
// Si oui, inutile de le redemarrer : il a deja la bonne scene et sa Virtual
// Camera. On evite ainsi les arrets/re-demarrages qui marquent OBS en
// "unclean shutdown" (dialogue de crash au demarrage suivant).
// NB : le check n'est pas declenche si OBS ne tourne pas (perf).
function obsRunningWithChapCamFlags() {
  if (process.platform !== 'win32') return false
  try {
    // UNE SEULE requete : on sort la CreationDate (UTC, format ISO 8601 'o'
    // — INVARIANT de locale) de l'instance saine, s'il y en a exactement une.
    //  - 0 ligne  : OBS absent, bloque sur un dialogue (~2 Mo) ou sans nos
    //               flags -> pas "deja bon".
    //  - >1 ligne : doublons anormaux -> on ne garde pas.
    // NB : CreationDate brut est LOCALISE ("jeudi 6 août 2026 14:56:42" en
    // francais) et new Date() ne sait pas le parser (NaN) : on force donc
    // ToUniversalTime().ToString('o') (ISO 8601, ex: 2026-08-06T14:56:42Z),
    // parseable par new Date() quel que soit le pays de Windows.
    const out = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='obs64.exe'\" | Where-Object { $_.CommandLine -match '--collection ChapCam' -and $_.CommandLine -match '--startvirtualcam' -and $_.WorkingSetSize -gt 104857600 } | Select-Object -ExpandProperty CreationDate | ForEach-Object { $_.ToUniversalTime().ToString('o') }",
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    )
    const lines = (out.stdout || '').trim().split(/\r?\n/).filter(Boolean)
    if (lines.length !== 1) return false
    const obsStart = new Date(lines[0]).getTime()
    if (!(obsStart > 0)) return false

    // Scene PERIMEE ? Si ChapCam.json a ete (re)ecrit APRES le demarrage de la
    // session OBS courante, cette instance OBS charge une scene obsolete en
    // memoire (ex: ancien mode de capture WGC qui donne un ecran noir). On ne
    // la garde pas : launchObs la redemarrera pour charger la scene a jour.
    try {
      const sceneFile = path.join(obsConfigDir(), 'basic', 'scenes', 'ChapCam.json')
      if (fs.existsSync(sceneFile)) {
        const sceneMtime = fs.statSync(sceneFile).mtimeMs
        // Marge de 2s : une scene ecrite juste AVANT le demarrage d'OBS a un
        // ordre de timestamps ambigue ; on ne redemarre que si elle est
        // clairement plus recente que la session.
        if (sceneMtime > obsStart + 2000) {
          log('Scene ChapCam plus recente que la session OBS — OBS sera redemarre pour la charger')
          return false
        }
      }
    } catch (_) {}
    return true
  } catch (_) {
    return false
  }
}

// La Virtual Camera de la session OBS courante a-t-elle reellement demarree ?
// Lit le log le plus recent (celui de la session en cours) et cherche la
// ligne "Virtual Camera Start". Utilise pour ne PAS garder un OBS "sain en
// apparence" dont la sortie Virtual Camera aurait echoue (filtre DirectShow
// absent, etc.) : dans ce cas il faut le redemarrer.
function obsLogShowsVirtualCam() {
  try {
    const log = newestObsLogPath()
    if (!log) return false
    const txt = fs.readFileSync(log.path, 'utf8')
    return /Virtual Camera Start|Starting Virtual Camera output|Virtual output started/i.test(txt)
  } catch (_) {
    return false
  }
}

// Chemin du log OBS le plus recent (%APPDATA%/obs-studio/logs/*.txt).
// OBS cree un nouveau fichier de log a CHAQUE demarrage : le plus recent est
// donc celui de la session en cours (ou une session plus ancienne si OBS n'a
// pas reussi a demarrer — aucune verification n'est alors possible).
// Retourne { path, mtime } ou null.
function newestObsLogPath() {
  try {
    const dir = path.join(obsConfigDir(), 'logs')
    if (!fs.existsSync(dir)) return null
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.txt$/i.test(f))
      .map((f) => path.join(dir, f))
    if (!files.length) return null
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return { path: files[0], mtime: fs.statSync(files[0]).mtimeMs }
  } catch (_) {
    return null
  }
}

// Attend que le log de la session OBS (demarree apres `logBefore`) confirme
// le demarrage de la Virtual Camera ("Starting Virtual Camera output").
// Ne considere que les logs PLUS RECENTS que logBefore : si OBS echoue avant
// d'ecrire son log (ex: "Failed to find locale/en-US.ini" qui bloque OBS
// avant l'initialisation du log), on ne doit pas lire un ancien log et
// conclure a tort que la Virtual Camera tourne.
//
// IMPORTANT : on ne conclut JAMAIS a l'echec avant le timeout. Un log OBS
// sain contient des lignes "Failed to initialize module 'aja/decklink/nvenc'"
// ecrites AVANT le demarrage de la Virtual Camera : tout test de contenu
// precoce donnerait des faux negatifs.
function waitForVirtualCamInLog(logBefore, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const beforePath = logBefore && logBefore.path
    const beforeMtime = logBefore && logBefore.mtime
    const started = Date.now()
    const check = () => {
      const current = newestObsLogPath()
      if (current) {
        let isNew = false
        try {
          isNew = current.path !== beforePath || fs.statSync(current.path).mtimeMs > beforeMtime + 1500
        } catch (_) {}
        if (isNew) {
          try {
            const txt = fs.readFileSync(current.path, 'utf8')
            if (/Virtual Camera Start|Starting Virtual Camera output|Virtual output started/i.test(txt)) {
              resolve(true)
              return
            }
          } catch (_) {}
        }
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(check, 500)
    }
    check()
  })
}

/**
 * Lance OBS Studio (avec la Virtual Camera au demarrage).
 *
 * Cree/rafraichit D'ABORD la scene "ChapCam" (capture de la fenetre) pour
 * que l'utilisateur n'ait rien a configurer.
 *
 * IMPORTANT — OBS deja ouvert : une instance OBS garde sa scene en memoire
 * (l'ancien window string vers electron.exe de dev) et ne recharge jamais le
 * ChapCam.json ecrit a cote. Sans rien faire, la Virtual Camera diffuse une
 * scene vide/ancienne -> l'utilisateur voit le LOGO OBS dans l'appel video.
 * On redemarre donc OBS proprement (kill + relance avec la scene a jour) pour
 * que la capture pointe toujours vers la fenetre ChapCam reelle.
 *
 * Retourne { launched, alreadyRunning, restarted, exe, scene, virtualCamStarted }.
 * --collection ChapCam : charge la collection creee automatiquement.
 * --scene ChapCam : force la scene active (au cas ou la collection en aurait
 *                   plusieurs, ou si OBS retenait la derniere scene).
 * --startvirtualcam : OBS demarre sa Virtual Camera des l'ouverture.
 * --minimize-to-tray : pas de fenetre qui gene l'utilisateur.
 *
 * options.force (true) : recree la scene ChapCam.json a coup sûr et OBS est
 * redemarre (meme s'il tournait deja avec la bonne scene) pour recharger la
 * source. Utile pour le bouton UI « Recréer la source OBS » : quand OBS a deja
 * tourne avec une scene en memoire et que la capture reste noire, on veut
 * forcer un cycle complet scene + OBS.
 */
async function launchObs(options = {}) {
  if (process.platform !== 'win32') {
    return { launched: false, alreadyRunning: false, restarted: false, exe: null, error: 'OBS requiert Windows' }
  }

  // Scene generee/rafraichie EN PREMIER : si la version de format a change
  // (ex: mode de capture bitblt en 1.0.9), le fichier ChapCam.json est reecrit
  // et sa date de modification devient plus recente que la session OBS en
  // cours -> le check alreadyGood ci-dessous detecte la scene perimee et
  // redemarre OBS pour charger la scene a jour. Sans ce premier appel, un OBS
  // deja actif garderait indefiniment l'ancienne scene (WGC -> ecran noir).
  // COMPORTEMENT SOUHAITÉ (fix WhatsApp écran noir) : CHAQUE clic sur "Lancer OBS"
  // écrase l'ancienne scène et recrée la nouvelle -> WhatsApp voit toujours la
  // capture à jour (window:Chrome_WidgetWin_1:ChapCam.exe + method:1 BitBlt).
  // On force donc la réécriture à chaque lancement, et on redémarre OBS pour
  // charger la scène fraîche — plus de cas "alreadyGood" qui garde une scène noire.
  const forceRecreate = true
  const scene = ensureObsSceneCollection(forceRecreate)

  const wasRunning = isObsBridgeRunning()
  const exe = findObsExecutable()

  // Plus de early-return alreadyGood : on écrase toujours (évite écran noir WhatsApp)
  if (false && wasRunning) {
    log('OBS deja actif avec la scene ChapCam + Virtual Camera — pas de redemarrage')
    return {
      launched: false,
      alreadyRunning: true,
      restarted: false,
      exe,
      scene,
      virtualCamStarted: true,
    }
  }

  if (wasRunning) {
    log('OBS deja ouvert — redemarrage systématique pour écraser avec la nouvelle scène ChapCam (fix WhatsApp noir)')
    await killObs()
    _obsCheck = { value: false, at: 0 }
    ensureObsSceneCollection(true)
  }

  if (!exe) {
    return { launched: false, alreadyRunning: wasRunning, restarted: wasRunning, exe: null, error: 'OBS Studio introuvable', scene }
  }

  // Supprimer les sentinelles de session restantes AVANT de lancer : un
  // demarrage precedemment interrompu afficherait sinon le dialogue
  // "Crash or unclean shutdown detected" qui bloque OBS.
  clearObsCrashSentinels()

  // Etat du log AVANT le lancement : la verification de la Virtual Camera ne
  // doit lire que la session OBS que l'on vient de demarrer (jamais l'ancienne).
  const logBefore = newestObsLogPath()

  try {
    const child = spawn(
      exe,
      ['--collection', 'ChapCam', '--scene', 'ChapCam', '--startvirtualcam', '--minimize-to-tray'],
      {
        // CRITIQUE (bug corrige en 1.0.7) : OBS doit demarrer avec SON
        // repertoire de travail. Sans cwd, OBS herite du repertoire de l'app
        // (ex: app.asar.unpacked) et ne trouve plus son fichier de langue
        // locale/en-US.ini -> boite de dialogue "Error: Failed to find
        // locale/en-US.ini" -> OBS reste BLOQUE au demarrage -> la Virtual
        // Camera ne demarre jamais -> l'appel video affiche le logo OBS /
        // camera barree dans WhatsApp. Avec cwd = dossier de obs64.exe, OBS
        // demarre normalement (verifie empiriquement sur OBS 32.2.1).
        cwd: path.dirname(exe),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    child.unref()
    log(`OBS lance avec --collection ChapCam --scene ChapCam --startvirtualcam (${exe})`)

    // Verification : attendre que le log OBS confirme le demarrage de la
    // Virtual Camera. En cas d'echec (dialogue de crash residuel, plantage
    // pendant le demarrage), on nettoie les sentinelles et on relance UNE
    // fois avec un delai plus long.
    let virtualCamStarted = await waitForVirtualCamInLog(logBefore, 8000)
    if (!virtualCamStarted) {
      log('Virtual Camera non detectee au 1er essai — nettoyage + relance (1 tentative)')
      await killObs()
      clearObsCrashSentinels()
      const logBefore2 = newestObsLogPath()
      try {
        const child2 = spawn(
          exe,
          ['--collection', 'ChapCam', '--scene', 'ChapCam', '--startvirtualcam', '--minimize-to-tray'],
          {
            cwd: path.dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          },
        )
        child2.unref()
        virtualCamStarted = await waitForVirtualCamInLog(logBefore2, 10000)
      } catch (e2) {
        log(`Relance OBS echouee: ${e2.message}`)
      }
    }
    if (!virtualCamStarted) {
      log('ATTENTION : la Virtual Camera OBS ne semble pas avoir demarre (log sans "Virtual Camera Start")')
    }
    return { launched: true, alreadyRunning: wasRunning, restarted: wasRunning, exe, scene, virtualCamStarted }
  } catch (e) {
    return { launched: false, alreadyRunning: wasRunning, restarted: wasRunning, exe, error: e.message || String(e), scene }
  }
}

// Resout le chemin du gestionnaire akvirtualcamera selon plateforme/arch.
function akvcamManagerPath() {  if (process.platform !== 'win32') return null
  const arch = process.arch === 'ia32' ? 'x86' : 'x64'
  const candidates = [
    // Empaquete dans l'app (production)
    path.join(process.resourcesPath || '', 'akvirtualcamera', arch, 'AkVCamManager.exe'),
    // Dev : binaire pose dans le repo
    path.join(__dirname, '..', 'resources', 'akvirtualcamera', arch, 'AkVCamManager.exe'),
    // Installation systeme du pilote (fallback)
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'AkVirtualCamera', arch, 'AkVCamManager.exe'),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

/**
 * Diffuse l'etat courant a toutes les fenetres web (indicateur UI + hooks).
 * Sans ca, l'UI ne voit les changements que via un polling de 3s.
 */
function broadcastState(state) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('virtual-camera-state', state)
      }
    }
  } catch (e) {
    log(`broadcastState: ${e.message}`)
  }
}

class VirtualCamera {
  constructor() {
    this.isRunning = false
    this.proc = null // process AkVCamManager stream / ffmpeg
    this.deviceName = DEVICE_DESCRIPTION
    this.width = DEFAULT.width
    this.height = DEFAULT.height
    this.fps = DEFAULT.fps
    this._rgb = null // buffer RGB24 reutilise (anti-GC)
    this._lastError = null
    this._frames = 0
    this._starting = false // anti double-start concurrent
    this._stdinPaused = false
    // Chemin de diffusion actif : 'obs' (principal) | 'driver' | 'none'.
    this.mode = 'none'
    // Guard pour le fallback automatique
    this._fallbackInProgress = false
    // Dernier resultat de verification de la Virtual Camera OBS
    // (true/false si OBS a ete lance par l'app, null sinon/au demarrage).
    this.virtualCamStarted = null
  }

  getStatus() {
    const obsRunning = isObsBridgeRunning()
    const obsAvailable = !!findObsExecutable()
    // Shape aligne sur lib/electron.ts VirtualCameraState (UI + hooks).
    return {
      running: this.isRunning,
      isRunning: this.isRunning, // compat anciennes builds
      deviceName: this.mode === 'obs' ? 'OBS Virtual Camera' : this.deviceName,
      platform: process.platform,
      width: this.width,
      height: this.height,
      fps: this.fps,
      available: this.isAvailable(),
      driverInstalled: this.isAvailable(),
      error: this._lastError,
      frames: this._frames,
      obsBridge: obsRunning,
      obsRunning,
      obsAvailable,
      mode: this.mode,
      virtualCamStarted: this.virtualCamStarted,
    }
  }

  // Le pilote est-il present sur la machine ?
  isAvailable() {
    if (process.platform === 'win32') return !!akvcamManagerPath()
    if (process.platform === 'linux') return fs.existsSync('/dev/video10')
    return false // macOS : voir startMacOS
  }

  async start(options = {}) {
    this.width = options.width || DEFAULT.width
    this.height = options.height || DEFAULT.height
    this.fps = options.fps || DEFAULT.fps
    this._lastError = null

    if (this.isRunning) {
      log('Deja active')
      return this.getStatus()
    }

    if (this._starting) {
      log('Demarrage deja en cours')
      return this.getStatus()
    }

    this._starting = true
    try {
      if (process.platform === 'win32') {
        // Chemin PRINCIPAL : OBS Virtual Camera. Si OBS est installe, on le
        // lance (ou on le REDEMARRE s'il tourne deja avec une scene perimee)
        // et le mode passe en 'obs'. OBS capture la fenetre ChapCam : aucune
        // frame a pousser au pilote.
        if (findObsExecutable()) {
          const launched = await launchObs()
          this.virtualCamStarted = !!launched.virtualCamStarted
          if (launched.error) {
            throw new Error(launched.error)
          }
          // Verifier reellement que OBS tourne (le process met ~2-8s a
          // demarrer, et un redemarrage prend kill+relance). Evite de
          // declarer la diffusion "active" si OBS ne s'est jamais lance
          // (install cassee, permissions).
          const obsUp = await waitForObsRunning(launched.restarted ? 12000 : 8000)
          if (!obsUp && !launched.alreadyRunning) {
            // OBS n'a pas demarre : fallback sur le pilote akvirtualcamera
            // (le pilote embarque qui marchait avant).
            log('OBS ne demarre pas — fallback sur le pilote ChapCam Camera')
            this.mode = 'driver'
            await this.startWindows()
            this.isRunning = true
            this._frames = 0
            this._stdinPaused = false
            log(`Pilote demarre (${this.deviceName} ${this.width}x${this.height}@${this.fps})`)
          } else {
            this.mode = 'obs'
            this.isRunning = true
            this._frames = 0
            this._stdinPaused = false
            log(
              launched.alreadyRunning
                ? 'OBS deja actif — verifie que sa Virtual Camera est demarree'
                : 'OBS lance — Virtual Camera en cours de demarrage',
            )
            log(`DIAG: OBS mode=obs virtualCamStarted=${this.virtualCamStarted} obsRunning=${isObsBridgeRunning()}`)
          }
        } else {
          // Fallback : pilote akvirtualcamera embarque.
          this.mode = 'driver'
          await this.startWindows()
          this.isRunning = true
          this._frames = 0
          this._stdinPaused = false
          log(`Pilote demarre (${this.deviceName} ${this.width}x${this.height}@${this.fps})`)
        }
      } else if (process.platform === 'linux') {
        this.mode = 'driver'
        await this.startLinux()
        this.isRunning = true
        this._frames = 0
        this._stdinPaused = false
      } else if (process.platform === 'darwin') {
        this.mode = 'driver'
        await this.startMacOS()
        this.isRunning = true
        this._frames = 0
        this._stdinPaused = false
      } else {
        throw new Error(`Plateforme non supportee: ${process.platform}`)
      }
    } catch (error) {
      this._lastError = error.message || String(error)
      log(`Echec demarrage: ${this._lastError}`)
      // Nettoyage partiel si le process a demarre puis a echoue
      this._killProc()
      this.isRunning = false
      this.mode = this.mode === 'obs' ? 'obs' : 'none'
      throw error
    } finally {
      this._starting = false
    }
    return this.getStatus()
  }

  stop() {
    this._killProc()
    this.isRunning = false
    this._starting = false
    this._stdinPaused = false
    // Mode OBS : on NE ferme PAS OBS (l'utilisateur peut l'utiliser pour
    // autre chose) — on signale juste que ChapCam n'est plus en diffusion.
    // Le pilote, lui, est bien arrete par _killProc.
    this.mode = this.mode === 'obs' ? 'obs' : 'none'
    // On ne conserve pas l'erreur d'un run precedent sur un stop volontaire
    // (sinon l'indicateur UI reste en rouge apres un arret manuel).
    // Les erreurs de crash process restent via _lastError jusqu'au prochain start.
    log('Arretee')
    return this.getStatus()
  }

  // ----------------------------------------------------------------
  // FALLBACK AUTOMATIQUE OBS -> PILOTE AKVIRTUALCAMERA
  // ----------------------------------------------------------------
  // Bascule automatiquement sur le pilote akvirtualcamera si demandé.
  async fallbackToDriver() {
    // Guard: eviter les fallbacks concurrents
    if (this._fallbackInProgress) {
      log('Fallback deja en cours, ignore')
      return false
    }

    if (this.mode !== 'obs') {
      return false
    }

    this._fallbackInProgress = true
    log('Fallback automatique: basculement sur le pilote ChapCam Camera')
    
    try {
      // Basculer sur le pilote
      this.mode = 'driver'
      await this.startWindows()
      this.isRunning = true
      this._frames = 0
      this._stdinPaused = false
      
      log(`Pilote demarre en fallback (${this.deviceName} ${this.width}x${this.height}@${this.fps})`)
      broadcastState(this.getStatus())
      return true
    } catch (e) {
      log(`Echec fallback: ${e.message}`)
      this._lastError = e.message
      broadcastState(this.getStatus())
      return false
    } finally {
      this._fallbackInProgress = false
    }
  }

  _killProc() {
    if (!this.proc) return
    const proc = this.proc
    this.proc = null
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.end()
      }
    } catch (_) {}
    try {
      // Windows : SIGTERM ne tue pas toujours le process ; kill() suffit.
      // Sur Linux/mac, SIGTERM puis SIGKILL en fallback.
      proc.kill()
      if (process.platform !== 'win32') {
        setTimeout(() => {
          try {
            if (!proc.killed) proc.kill('SIGKILL')
          } catch (_) {}
        }, 500).unref?.()
      }
    } catch (_) {}
  }

  // ----------------------------------------------------------------
  // WINDOWS : pilote akvirtualcamera (DirectShow + Media Foundation)
  // ----------------------------------------------------------------
  async startWindows() {
    const manager = akvcamManagerPath()
    if (!manager) {
      throw new Error(
        'Pilote "ChapCam Camera" introuvable. Reinstalle ChapCam pour installer le pilote camera.',
      )
    }

    // L'assistant doit tourner pour que le peripherique soit "arme" et donc
    // expose aux applications systeme. Lancer si aucun n'est deja en cours.
    this.ensureAssistant()

    // S'assurer que le dispositif existe et expose le bon format.
    await this.ensureWindowsDevice(manager)

    // Lancer le flux : AkVCamManager lit des frames RGB24 brutes sur stdin.
    // Syntaxe v9.4 : stream <deviceId> <format> <largeur> <hauteur> -f <fps>
    // (avant v9.3, le fps etait un argument positionnel a la fin).
    this.proc = spawn(
      manager,
      [
        'stream',
        DEVICE_ID,
        'RGB24',
        String(this.width),
        String(this.height),
        '-f',
        String(this.fps),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    // Attendre un court instant pour detecter un crash immediat (device
    // verrouille, mauvais format, etc.) au lieu de renvoyer running:true
    // sur un process deja mort.
    await new Promise((resolve, reject) => {
      let settled = false
      const onEarlyClose = (code) => {
        if (settled) return
        settled = true
        this.proc = null
        reject(new Error(`AkVCamManager s'est arrete immediatement (code ${code}). Verifie que le pilote est installe et qu'aucune autre app ne verrouille ChapCam Camera.`))
      }
      const onEarlyError = (e) => {
        if (settled) return
        settled = true
        this.proc = null
        reject(new Error(`Impossible de lancer AkVCamManager: ${e.message}`))
      }

      this.proc.once('close', onEarlyClose)
      this.proc.once('error', onEarlyError)

      // Si le process est encore vivant apres 400ms, on considere le demarrage OK.
      setTimeout(() => {
        if (settled) return
        settled = true
        this.proc.removeListener('close', onEarlyClose)
        this.proc.removeListener('error', onEarlyError)
        resolve()
      }, 400)
    })

    this.proc.stderr.on('data', (d) => {
      const msg = String(d).trim()
      if (msg) log(`akvcam: ${msg}`)
    })
    this.proc.on('error', (e) => {
      this._lastError = e.message
      log(`Erreur process: ${e.message}`)
      this.isRunning = false
      this.proc = null
      broadcastState(this.getStatus())
    })
    this.proc.on('close', (code) => {
      log(`Flux termine (code ${code})`)
      const wasRunning = this.isRunning
      this.isRunning = false
      this.proc = null
      // Crash inattendu (pas un stop() volontaire qui a deja null-ifie proc
      // avant le kill) : exposer l'erreur a l'UI.
      if (wasRunning && code !== 0 && code !== null) {
        this._lastError = `Flux camera virtuelle interrompu (code ${code})`
      }
      broadcastState(this.getStatus())
    })
  }

  // Cree/renomme le peripherique "ChapCam Camera" et configure son format.
  // Idempotent : peut etre relance a chaque demarrage sans casser l'existant.
  // Rejette si le binaire est cassé ou si add-device echoue de facon critique.
  ensureAssistant() {
    try {
      // Deja un assistant en cours ? Ne pas dupliquer.
      const found = spawnSync('tasklist', ['/fi', 'IMAGENAME eq AkVCamAssistant.exe'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      if (found.stdout && /AkVCamAssistant\.exe/i.test(found.stdout)) return

      const dir = akvcamManagerPath()
      const exe = dir ? path.join(path.dirname(dir), 'AkVCamAssistant.exe') : null
      if (!exe || !fs.existsSync(exe)) {
        log('ensureAssistant: AkVCamAssistant.exe introuvable')
        return
      }
      // Le lancer de maniere detachee (pas un enfant du process principal,
      // sinon il mourrait avec ChapCam). shell:true + detached + unref.
      const child = spawn(exe, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      })
      child.unref()
      log(`ensureAssistant: AkVCamAssistant.exe lance (${exe})`)
    } catch (e) {
      log(`ensureAssistant: ${e.message}`)
    }
  }

  ensureWindowsDevice(manager) {
    const run = (args, timeout = 15000) =>
      new Promise((res) => {
        execFile(manager, args, { timeout }, (err, stdout, stderr) => {
          if (err) log(`(${args[0]}) ${stderr || err.message}`)
          res({ stdout: String(stdout || ''), stderr: String(stderr || ''), err })
        })
      })

    return (async () => {
      // Le device existe-t-il deja ?
      // Sortie possible de `devices` (selon version du manager) :
      //   - simple : une ligne par ID  ("ChapCamCamera")
      //   - tableau : "| ChapCamCamera | ChapCam Camera | false |"
      const listed = await run(['devices'])
      const listLines = listed.stdout.split(/\r?\n/).map((l) => l.trim())
      const exists = listLines.some(
        (l) => l === DEVICE_ID || l.includes(`| ${DEVICE_ID} |`),
      )

      if (!exists) {
        // Syntaxe v9 : add-device -i <id> "<nom affiche>"
        const added = await run(['add-device', '-i', DEVICE_ID, DEVICE_DESCRIPTION])
        if (added.err) {
          // Peut deja exister sous un autre listing — on continue et on re-check.
          log(`add-device a renvoye une erreur (peut etre benign): ${added.stderr || added.err.message}`)
        }
        // (Re)declarer le format de sortie souhaite (uniquement a la creation)
        await run([
          'add-format',
          DEVICE_ID,
          'RGB24',
          String(this.width),
          String(this.height),
          String(this.fps),
        ], 5000)
      }

      // Appliquer la configuration. `update` peut bloquer sur certaines
      // versions du manager : timeout court, son echec n'est pas critique
      // si le device est deja en place (la verification finale decide).
      await run(['update'], 5000)

      // Verification post-setup : le device doit apparaitre.
      const verify = await run(['devices'])
      const verifyLines = verify.stdout.split(/\r?\n/).map((l) => l.trim())
      const ok = verifyLines.some(
        (l) => l === DEVICE_ID || l.includes(`| ${DEVICE_ID} |`),
      )
      if (!ok) {
        throw new Error(
          'Impossible de creer le peripherique "ChapCam Camera". Reinstalle le pilote (droits admin).',
        )
      }
    })()
  }

  // ----------------------------------------------------------------
  // LINUX : v4l2loopback via ffmpeg (dev/tests)
  // ----------------------------------------------------------------
  async startLinux() {
    const device = '/dev/video10'
    if (!fs.existsSync(device)) {
      throw new Error(
        'v4l2loopback absent. Installe-le : sudo modprobe v4l2loopback video_nr=10 card_label="ChapCam Camera"',
      )
    }
    this.proc = spawn(
      'ffmpeg',
      [
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s', `${this.width}x${this.height}`,
        '-r', String(this.fps),
        '-i', 'pipe:0',
        '-f', 'v4l2',
        '-pix_fmt', 'yuv420p',
        device,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    this.proc.stderr.on('data', (d) => {
      const s = String(d)
      if (/error|invalid|No such/i.test(s)) log(`ffmpeg: ${s.trim()}`)
    })
    this.proc.on('error', (e) => {
      this._lastError = e.message
      this.isRunning = false
      this.proc = null
      broadcastState(this.getStatus())
    })
    this.proc.on('close', (code) => {
      log(`ffmpeg termine (code ${code})`)
      this.isRunning = false
      this.proc = null
      broadcastState(this.getStatus())
    })
  }

  // ----------------------------------------------------------------
  // macOS : pilote CMIO (akvirtualcamera fournit aussi macOS). Non cable ici.
  // ----------------------------------------------------------------
  async startMacOS() {
    throw new Error(
      'Camera virtuelle macOS non encore cablee. Le pilote akvirtualcamera macOS doit etre installe et streame de la meme facon.',
    )
  }

  /**
   * Recoit une frame RGBA (Uint8/Buffer, longueur = w*h*4) depuis le renderer,
   * la convertit au format attendu par le pilote, et l'ecrit sur stdin.
   */
  writeFrame(rgba, width, height) {
    if (!this.isRunning || !this.proc || !this.proc.stdin || !this.proc.stdin.writable) return
    // Back-pressure : si le pipe est sature, on drop jusqu'a drain.
    if (this._stdinPaused) return

    // Linux/ffmpeg : on envoie le RGBA tel quel (pix_fmt rgba).
    if (process.platform === 'linux') {
      this._safeWrite(Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba))
      return
    }

    // Windows/akvcam : conversion RGBA -> RGB24 (+ swap R/B et flip vertical au besoin).
    const w = width || this.width
    const h = height || this.height
    const need = w * h * 3
    if (!this._rgb || this._rgb.length !== need) this._rgb = Buffer.allocUnsafe(need)
    const out = this._rgb
    const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba)

    // Garde-fou : frame incomplete (IPC partiel) — on drop plutot que d'ecrire
    // des pixels corrompus qui font planter le pilote.
    if (src.length < w * h * 4) {
      if (this._frames % 60 === 0) log(`frame incomplete (${src.length} < ${w * h * 4}), drop`)
      return
    }

    for (let y = 0; y < h; y++) {
      const sy = FLIP_V ? h - 1 - y : y
      let si = sy * w * 4
      let di = y * w * 3
      for (let x = 0; x < w; x++) {
        const r = src[si]
        const g = src[si + 1]
        const b = src[si + 2]
        if (SWAP_RB) {
          out[di] = b
          out[di + 1] = g
          out[di + 2] = r
        } else {
          out[di] = r
          out[di + 1] = g
          out[di + 2] = b
        }
        si += 4
        di += 3
      }
    }
    this._safeWrite(out)
  }

  _safeWrite(buf) {
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return
    try {
      // back-pressure : si le pipe est sature, on laisse tomber la frame
      // (on privilegie la latence a l'exhaustivite).
      const ok = this.proc.stdin.write(buf)
      this._frames++
      if (!ok) {
        this._stdinPaused = true
        this.proc.stdin.once('drain', () => {
          this._stdinPaused = false
        })
        if (this._frames % 120 === 0) log('stdin sature : frames droppees pour garder la latence')
      }
    } catch (e) {
      this._lastError = e.message
      log(`writeFrame error: ${e.message}`)
    }
  }
}

// ---- Singleton ----
let instance = null
function getVirtualCamera() {
  if (!instance) instance = new VirtualCamera()
  return instance
}

// ---- IPC ----
function setupVirtualCameraIPC() {
  // IMPORTANT : demarrer aussi la capture cote renderer (preload).
  // Sans `vcam:start`, AkVCamManager tourne a vide → WhatsApp/Zoom reçoivent
  // une camera noire. Le menu/tray le faisait deja via main.js ; l'UI Live Swap
  // passait uniquement par ces handlers et oubliait la capture.
  ipcMain.handle('virtual-camera-start', async (event, options) => {
    const opts = options || {}
    try {
      const status = await getVirtualCamera().start(opts)
      // En mode OBS, OBS capture directement la fenetre ChapCam : aucune
      // capture pixel cote renderer a demarrer (economise le CPU, et la
      // fenetre doit rester visible pour OBS). En mode pilote, on demarre
      // bien la capture pour pousser les frames au pilote.
      if (status.mode !== 'obs') {
        try {
          const wc = event?.sender
          if (wc && !wc.isDestroyed()) {
            wc.send('vcam:start', {
              width: opts.width || DEFAULT.width,
              height: opts.height || DEFAULT.height,
              fps: opts.fps || DEFAULT.fps,
            })
          }
        } catch (e) {
          log(`Impossible d'envoyer vcam:start au renderer: ${e.message}`)
        }
      }
      broadcastState(status)
      return status
    } catch (e) {
      const status = getVirtualCamera().getStatus()
      // getStatus() a deja _lastError ; on force au cas ou.
      if (!status.error) status.error = e.message || String(e)
      broadcastState(status)
      // Renvoyer l'etat (pas throw) pour que le renderer puisse afficher
      // l'erreur sans unreject non gere. running reste false.
      return status
    }
  })

  // Fallback manuel OBS -> pilote akvirtualcamera
  ipcMain.handle('virtual-camera-fallback-to-driver', async () => {
    const vc = getVirtualCamera()
    const fallbackSuccess = await vc.fallbackToDriver()
    return { fallback: fallbackSuccess, status: vc.getStatus() }
  })

  // Lancer OBS Studio (avec --startvirtualcam) depuis l'UI.
  // options.force = true : recrée la scene et redemarre OBS (bouton
  // « Recréer la source OBS » quand la capture reste noire).
  ipcMain.handle('virtual-camera-launch-obs', async (_event, options) => {
    const result = await launchObs(options || {})
    // Apres un redemarrage, attendre qu'OBS soit reellement revenu avant de
    // repondre : l'UI affiche "actif" uniquement si OBS tourne vraiment.
    if (result && result.launched && result.restarted) {
      await waitForObsRunning(12000)
    }
    broadcastState(getVirtualCamera().getStatus())
    return result
  })

  ipcMain.handle('virtual-camera-stop', async (event) => {
    try {
      const wc = event?.sender
      if (wc && !wc.isDestroyed()) {
        wc.send('vcam:stop')
      }
    } catch (e) {
      log(`Impossible d'envoyer vcam:stop au renderer: ${e.message}`)
    }
    // Stop volontaire : effacer l'erreur precedente pour ne pas laisser
    // l'indicateur UI en rouge.
    const vc = getVirtualCamera()
    vc._lastError = null
    const status = vc.stop()
    broadcastState(status)
    return status
  })

  ipcMain.handle('virtual-camera-status', async () => {
    const st = getVirtualCamera().getStatus()
    log(`DIAG: virtual-camera-status → running=${st.running} mode=${st.mode} obsRunning=${st.obsRunning} obsAvailable=${st.obsAvailable} error=${st.error || 'aucune'}`)
    return st
  })

  // Frames poussees par le renderer (preload). On evite invoke (trop lourd a 30fps)
  // au profit de send/on.
  // payload.buffer peut etre ArrayBuffer, Uint8Array ou Buffer selon la
  // serialisation IPC Electron — on normalise en Buffer.
  ipcMain.on('vcam:frame', (_e, payload) => {
    if (!payload) return
    const raw = payload.buffer
    if (!raw) return
    let view
    try {
      if (Buffer.isBuffer(raw)) {
        view = raw
      } else if (raw instanceof ArrayBuffer) {
        view = Buffer.from(raw)
      } else if (ArrayBuffer.isView(raw)) {
        view = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      } else {
        view = Buffer.from(raw)
      }
    } catch (e) {
      // Frame corrompue — drop silencieux (trop bruyant a 30fps).
      return
    }
    getVirtualCamera().writeFrame(view, payload.width, payload.height)
  })
}

module.exports = {
  VirtualCamera,
  getVirtualCamera,
  setupVirtualCameraIPC,
  broadcastState,
  launchObs,
  findObsExecutable,
  isObsBridgeRunning,
  ensureObsSceneCollection,
  normalizeObsProfile,
  buildChapCamSceneCollection,
  obsConfigDir,
  CHAPCAM_WINDOW_TITLE,
  DEVICE_DESCRIPTION,
  DEVICE_ID,
}
