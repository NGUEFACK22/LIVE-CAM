/**
 * Regeneration de la scene OBS "ChapCam" sur la VRAIE machine.
 *
 * - Tue les instances OBS (obs64.exe) pour liberer la config (sinon OBS
 *   reecrit user.ini a sa fermeture et nos cles seraient perdues).
 * - Supprime les collections de scenes obsoletes (ChapCam_Bridge, .bak,
 *   .backup) pour une config propre et coherente.
 * - Regenere ChapCam.json avec le window string corrige (exe = basename) et
 *   selectionne la collection "ChapCam" comme active dans user.ini.
 *
 * Usage : node scripts/regenerate-obs-scene.cjs
 */
const Module = require('module')
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

const realLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle() {}, on() {} },
      BrowserWindow: { getAllWindows: () => [] },
    }
  }
  if (request === 'child_process') {
    const realCp = realLoad.apply(this, arguments)
    return {
      ...realCp,
      // isObsBridgeRunning() lance tasklist : on force "OBS ne tourne pas"
      // pour que ensureObsSceneCollection ecrive bien user.ini.
      spawnSync: (cmd, args, opts) => {
        if (cmd === 'tasklist') return { stdout: '', stderr: '', status: 1 }
        return realCp.spawnSync(cmd, args, opts)
      },
    }
  }
  return realLoad.apply(this, arguments)
}

const vc = require(path.join(__dirname, '..', 'electron', 'virtual-camera.js'))
Module._load = realLoad

const APPDATA = process.env.APPDATA
const obsDir = path.join(APPDATA, 'obs-studio')
const scenesDir = path.join(obsDir, 'basic', 'scenes')

function log(msg) {
  console.log(`[regenerate] ${msg}`)
}

// ---- 1. Tuer OBS (toutes instances) ----
log('Arret des instances OBS...')
const kill = spawnSync('taskkill', ['/IM', 'obs64.exe', '/F'], {
  encoding: 'utf8',
  windowsHide: true,
})
log(kill.stdout ? kill.stdout.trim().split('\n')[0] : 'aucune instance a arreter (ou deja arretee)')

// Attendre la disparition reelle
const start = Date.now()
while (Date.now() - start < 8000) {
  const chk = spawnSync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (!/obs64\.exe/i.test(chk.stdout || '')) break
  require('child_process').execSync('timeout /t 1 /nobreak >nul', { shell: 'cmd' })
}

// ---- 2. Profil OBS : forcer une resolution standard (1280x720) ----
// Le profil actif est quasi vide => OBS retombe sur une resolution exotique
// (ex: 1092x614 dans le log) que WhatsApp/Zoom peuvent mal gerer. On passe
// par normalizeObsProfile() du module (lit le ProfileDir actif depuis
// user.ini, backup + idempotent) pour rester coherent avec l'app.
const profileChanged = vc.normalizeObsProfile()
log(profileChanged ? 'Profil OBS normalise a 1280x720@30' : 'Profil OBS deja configure (1280x720) — aucune modification')

// ---- 3. Supprimer les scenes obsoletes ----
const toDelete = [
  'ChapCam_Bridge.json',
  'ChapCam_Bridge.json.bak',
  'Sans_nom.backup.json',
  'Sans_nom.backup.json.bak',
]
for (const f of toDelete) {
  const p = path.join(scenesDir, f)
  if (fs.existsSync(p)) {
    fs.unlinkSync(p)
    log(`Supprime: ${f}`)
  }
}

// ---- 4. Regenerer la scene ChapCam (code corrige) ----
// IMPORTANT : process.execPath vaut node.exe quand on lance ce script via
// node. La scene doit pointer vers l'exe REEL de l'app (ChapCam.exe). On
// force donc le chemin via CHAPCAM_EXE (ou detection de l'installation).
const CHAPCAM_EXE =
  process.env.CHAPCAM_EXE ||
  (() => {
    const candidates = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'ChapCam', 'ChapCam.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'ChapCam', 'ChapCam.exe'),
    ]
    return candidates.find((c) => fs.existsSync(c)) || null
  })()
if (!CHAPCAM_EXE) {
  log('AVERTISSEMENT: ChapCam.exe introuvable — la scene pointera sur le process courant')
}

log('Generation de la scene ChapCam (window string corrige)...')
const res = vc.ensureObsSceneCollection()
if (!res.ok) {
  log(`ECHEC: ${res.error}`)
  process.exit(1)
}
log(`Scene ecrite: ${res.file}`)

// ---- 5. Reecrire le window string avec l'exe REEL (ChapCam.exe) ----
// ensureObsSceneCollection utilise la fonction interne buildChapCamSceneCollection
// qui, executee via node, lit process.execPath = node.exe. On reecrit donc le
// champ window du fichier genere avec le basename de l'app installee.
const written = JSON.parse(fs.readFileSync(res.file, 'utf8'))
const winSrc = written.sources.find((s) => s.id === 'window_capture')
if (winSrc && winSrc.settings && CHAPCAM_EXE) {
  const base = path.basename(CHAPCAM_EXE)
  const parts = String(winSrc.settings.window || '').split(':')
  winSrc.settings.window = `${parts[0]}:${parts[1]}:${base}:`
  fs.writeFileSync(res.file, JSON.stringify(written, null, 4), 'utf8')
  log(`Exe cible pour la capture: ${CHAPCAM_EXE} (basename=${base})`)
}

// ---- 6. Verification finale du window string ----
const w2 = (winSrc && winSrc.settings && winSrc.settings.window) || ''
const exePart = (w2.match(/^[^:]+:Chrome_WidgetWin_1:(.*):$/) || [])[1] || ''
log(`window = ${w2}`)
if (!exePart || exePart.includes(':') || exePart.includes('\\')) {
  log('ERREUR: exe contient encore un chemin complet !')
  process.exit(1)
}
log(`exe (basename) = ${exePart} — OK`)

// ---- 7. user.ini : collection active ----
const iniPath = path.join(obsDir, 'user.ini')
if (fs.existsSync(iniPath)) {
  const ini = fs.readFileSync(iniPath, 'utf8')
  const sc = (ini.match(/^SceneCollection=(.+)$/m) || [])[1]
  const scf = (ini.match(/^SceneCollectionFile=(.+)$/m) || [])[1]
  log(`user.ini: SceneCollection=${sc}, SceneCollectionFile=${scf}`)
}

log('TERMINE — tout est coherent.')
