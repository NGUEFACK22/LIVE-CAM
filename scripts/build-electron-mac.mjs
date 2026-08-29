/**
 * Build du .dmg desktop ChapCam (MacBook Intel + Apple Silicon).
 * ---------------------------------------------------------------
 * Même logique que build-electron-win.mjs :
 *   1. sauvegarde .env.local  -> .env.local.dev-backup
 *   2. copie .env.electron    -> .env.local  (valeurs CLOUD, voir .env.electron)
 *   3. lance `next build` + `electron-builder --mac`
 *   4. restaure .env.local depuis le backup (meme en cas d'echec)
 *
 * Usage : node scripts/build-electron-mac.mjs
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envLocal = path.join(root, '.env.local')
const envElectron = path.join(root, '.env.electron')
const backup = path.join(root, '.env.local.dev-backup')

const log = (m) => console.log(`\n[build-electron-mac] ${m}`)

if (!fs.existsSync(envElectron)) {
  console.error('[build-electron-mac] ERREUR : .env.electron introuvable. Copiez .env.example vers .env.electron et remplissez les valeurs cloud.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Charge .env.electron DANS process.env pour que `next build` inline les
// valeurs CLOUD meme si des variables d'ENVIRONNEMENT SYSTEME existent.
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  const loaded = {}
  const txt = fs.readFileSync(file, 'utf8')
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    loaded[m[1]] = val
  }
  for (const [k, v] of Object.entries(loaded)) {
    if (v) {
      process.env[k] = v
    } else {
      delete process.env[k]
    }
  }
  for (const k of Object.keys(process.env)) {
    if ((k.startsWith('NEXT_PUBLIC_') || k.startsWith('SUPABASE_')) && !(k in loaded)) {
      delete process.env[k]
    }
  }
  return loaded
}

// --- 1. Sauvegarde du .env.local de dev ---
const hadLocal = fs.existsSync(envLocal)
if (hadLocal) {
  fs.copyFileSync(envLocal, backup)
  log('Sauvegarde .env.local -> .env.local.dev-backup')
} else {
  log('Pas de .env.local existant (rien a sauvegarder)')
}

// --- 2. Bascule vers les valeurs cloud ---
fs.copyFileSync(envElectron, envLocal)
log('Bascule .env.local <- .env.electron (valeurs CLOUD)')

try {
  // --- 3. Build Next + packaging ---
  const loaded = loadEnvFile(envElectron)
  log(`Variables cloud chargees dans process.env (URL: ${loaded.NEXT_PUBLIC_SUPABASE_URL || 'ABSENTE !'})`)
  fs.rmSync(path.join(root, '.next'), { recursive: true, force: true })
  log('Next build...')
  execSync('npx next build --webpack', { cwd: root, stdio: 'inherit' })

  // --- 3b. Sanitization AVANT packaging ---
  try {
    const raw = fs.readFileSync(envLocal, 'utf8')
    const sanitized = raw
      .split(/\r?\n/)
      .map((line) => {
        if (/^\s*DECART_API_KEY\s*=/.test(line)) return '# DECART_API_KEY= (retirée du build — fournie via Supabase app_config)'
        if (/^\s*DECART_API_KEY_NO_WATERMARK\s*=/.test(line)) return '# DECART_API_KEY_NO_WATERMARK= (retirée du build)'
        if (/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=/.test(line) && !/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*$/.test(line)) return 'SUPABASE_SERVICE_ROLE_KEY='
        if (/^\s*(LIVE_GPU_SHARED_SECRET|RUNPOD_API_KEY|LIVEKIT_API_SECRET|RESEND_API_KEY|TURNSTILE_SECRET_KEY)\s*=/.test(line)) {
          return line.replace(/=.*/, '=')
        }
        return line
      })
      .join('\n')
    fs.writeFileSync(envLocal, sanitized, 'utf8')
    log('Sanitization .env.local empaqueté : secrets retirés (DECART/supabase service_role blanchis)')
  } catch (e) {
    log(`Sanitization échouée (non bloquant): ${e.message}`)
  }

  log('electron-builder --mac...')
  execSync('npx electron-builder --mac', { cwd: root, stdio: 'inherit' })
  log('BUILD TERMINE')
} catch (err) {
  console.error('\n[build-electron-mac] ECHEC DU BUILD:', err.message)
  process.exitCode = 1
} finally {
  // --- 4. Restauration du .env.local de dev (toujours, meme en echec) ---
  if (hadLocal && fs.existsSync(backup)) {
    fs.copyFileSync(backup, envLocal)
    fs.unlinkSync(backup)
    log('.env.local de dev restaure')
  } else {
    fs.rmSync(envLocal, { force: true })
    log('.env.local supprime (il n\'existait pas avant)')
  }
}