/**
 * Test de validation de la scene OBS auto-generee "ChapCam".
 * Charge electron/virtual-camera.js en stubbant require('electron') (node pur),
 * genere la collection, verifie la structure et compare au fichier de
 * reference ChapCam_Bridge.json (OBS 32) present sur la machine.
 *
 * Usage : node scripts/test-obs-scene.cjs
 */
const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ---- Stub electron (node pur n'a pas electron) ----
const realLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle() {}, on() {} },
      BrowserWindow: { getAllWindows: () => [] },
    }
  }
  // isObsBridgeRunning() lance tasklist — on force "OBS ne tourne pas" pour
  // que ensureObsSceneCollection modifie toujours user.ini dans le test.
  if (request === 'child_process') {
    const realCp = realLoad.apply(this, arguments)
    return {
      ...realCp,
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

let failures = 0
function check(name, cond, extra) {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

// ---- 1. Generation du JSON ----
console.log('== Generation de la scene ==')
const scene = vc.buildChapCamSceneCollection()
const json = JSON.stringify(scene, null, 2) // doit etre du JSON valide
const parsed = JSON.parse(json)
check('JSON valide', !!parsed)

// ---- 2. Structure top-level, comparee au fichier OBS 32 existant ----
console.log('== Structure vs ChapCam_Bridge.json ==')
const refPath = path.join(process.env.APPDATA || '', 'obs-studio', 'basic', 'scenes', 'ChapCam_Bridge.json')
let refKeys = []
if (fs.existsSync(refPath)) {
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'))
  refKeys = Object.keys(ref)
  const genKeys = Object.keys(parsed)
  const missing = refKeys.filter((k) => !genKeys.includes(k))
  check('Toutes les cles top-level du fichier de reference sont presentes', missing.length === 0, `manquantes: ${missing.join(', ')}`)
  // Les cles du fichier de reference doivent etre un SUBSET de celles generees
  // (on genere la meme chose, eventuellement + quelques nouvelles).
  const extra = genKeys.filter((k) => !refKeys.includes(k))
  console.log(`  ℹ️ cles supplementaires generees: ${extra.join(', ') || '(aucune)'}`)
} else {
  console.log(`  ⚠️ fichier de reference absent (${refPath}) — comparaison skippee`)
}

// ---- 3. Source window_capture ----
console.log('== Source window_capture ==')
const winSrc = parsed.sources.find((s) => s.id === 'window_capture')
check('Source window_capture presente', !!winSrc)
if (winSrc) {
  // Fix 1.0.10 : OBS 30+ lit "method" (ENTIER) ; 0 = auto (WGC sur machines
  // saines). La valeur chaine "bitblt" etait ignoree -> retombait sur auto.
  check('method = 0 (auto, ENTIER — format OBS 30+)', winSrc.settings.method === 0)
  check('capture_mode = auto (compat OBS 28/29)', winSrc.settings.capture_mode === 'auto')
  check('client_area = true', winSrc.settings.client_area === true)
  const w = winSrc.settings.window || ''
  check(
    'window string au format Titre:Classe:Exe:',
    /^[^:]+:Chrome_WidgetWin_1:.+:$/.test(w),
    `window="${w}"`,
  )
  // BUG 1.0.6 : le chemin complet (C:\Program Files\ChapCam\ChapCam.exe)
  // fait splitter OBS sur les ':' — il ne retient que "C" comme executable et
  // ne trouve jamais la fenetre (logo OBS dans les appels video). L'exe doit
  // etre UNIQUEMENT le nom du fichier (basename), sans ':' ni '\\'.
  const exePart = (w.match(/^[^:]+:Chrome_WidgetWin_1:(.*):$/) || [])[1] || ''
  check(
    'exe = basename uniquement (pas de chemin complet)',
    !!exePart && !exePart.includes(':') && !exePart.includes('\\') && /^[^/\\]+$/.test(exePart),
    `exe="${exePart}"`,
  )
}

// ---- 4. Scene + scene_item ----
console.log('== Scene ChapCam ==')
const sceneSrc = parsed.sources.find((s) => s.id === 'scene')
check('Scene presente', !!sceneSrc)
check('current_scene = ChapCam', parsed.current_scene === 'ChapCam')
check('scene_order contient ChapCam', parsed.scene_order && parsed.scene_order.some((s) => s.name === 'ChapCam'))
if (sceneSrc) {
  const items = sceneSrc.settings && sceneSrc.settings.items
  check('1 scene_item (la capture)', Array.isArray(items) && items.length === 1)
  if (items && items[0]) {
    check('scene_item pointe la source window_capture', items[0].source_uuid === winSrc.uuid)
    check('scene_item en bounds_type=2 (remplit le canvas)', items[0].bounds_type === 2)
  }
}

// ---- 5. Ecriture reelle dans un dossier temporaire (test ensureObsSceneCollection) ----
console.log('== Ecriture dans un dossier temporaire ==')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-test-'))
const oldAppData = process.env.APPDATA
process.env.APPDATA = tmpDir
// user.ini factice avec une collection active precedente
const fakeUserIni = `[General]\nFirstRun=true\n\n[Basic]\nProfile=Sans nom\nProfileDir=Sans_nom\nSceneCollection=Ancienne Scene\nSceneCollectionFile=Ancienne.json\n`
const obsDir = path.join(tmpDir, 'obs-studio')
fs.mkdirSync(path.join(obsDir, 'basic', 'scenes'), { recursive: true })
fs.writeFileSync(path.join(obsDir, 'user.ini'), fakeUserIni, 'utf8')

const res = vc.ensureObsSceneCollection()
check('ensureObsSceneCollection ok', res.ok, JSON.stringify(res))
if (res.ok) {
  const written = fs.readFileSync(res.file, 'utf8')
  const wParsed = JSON.parse(written)
  check('Fichier ChapCam.json ecrit et lisible', wParsed.name === 'ChapCam')
  const newIni = fs.readFileSync(path.join(obsDir, 'user.ini'), 'utf8')
  check(
    'user.ini: SceneCollection=ChapCam',
    /^SceneCollection=ChapCam$/m.test(newIni),
    newIni.split('\n').filter((l) => l.includes('SceneCollection')).join(' | '),
  )
  check('user.ini: SceneCollectionFile=ChapCam.json', /^SceneCollectionFile=ChapCam\.json$/m.test(newIni))
  const bak = fs.existsSync(path.join(obsDir, 'user.ini.chapcam.bak'))
  check('Backup user.ini.chapcam.bak cree', bak)
}
process.env.APPDATA = oldAppData
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

console.log('')
console.log(failures === 0 ? '🎉 TOUS LES TESTS PASSENT' : `❌ ${failures} test(s) en echec`)
process.exit(failures === 0 ? 0 : 1)
