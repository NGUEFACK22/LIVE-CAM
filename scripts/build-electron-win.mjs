/**
 * Build de l'installeur desktop ChapCam.
 * ---------------------------------------------------------------
 * Le .env.local du developpeur pointe vers le Supabase LOCAL Docker
 * (http://localhost:54321, cles "supabase-demo") — il ne doit JAMAIS
 * etre embarque dans l'app distribuee (sinon login/inscription casse).
 *
 * Ce script :
 *   1. sauvegarde .env.local  -> .env.local.dev-backup
 *   2. copie .env.electron    -> .env.local  (valeurs CLOUD, voir .env.electron)
 *   3. lance `next build` + `electron-builder --win`
 *   4. restaure .env.local depuis le backup (meme en cas d'echec)
 *
 * Usage : node scripts/build-electron-win.mjs
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const envLocal = path.join(root, '.env.local')
const envElectron = path.join(root, '.env.electron')
const backup = path.join(root, '.env.local.dev-backup')

const log = (m) => console.log(`\n[build-electron] ${m}`)

if (!fs.existsSync(envElectron)) {
  console.error('[build-electron] ERREUR : .env.electron introuvable. Copiez .env.example vers .env.electron et remplissez les valeurs cloud.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Charge .env.electron DANS process.env pour que `next build` inline les
// valeurs CLOUD meme si des variables d'ENVIRONNEMENT SYSTEME existent
// (ex: NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 pose par le setup
// Docker local). Dans Next.js les variables reelles du shell ont PRIORITE
// sur les fichiers .env : sans cet ecrasement, le build embarquerait les
// cles de dev et le login/inscription casseraient chez les utilisateurs.
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
  // Ecraser les variables systeme par les valeurs du fichier
  for (const [k, v] of Object.entries(loaded)) {
    if (v) {
      process.env[k] = v
    } else {
      delete process.env[k]
    }
  }
  // Neutraliser toute variable systeme NEXT_PUBLIC_*/SUPABASE_* qui n'est
  // PAS dans le fichier (sinon elle fuiterait dans le bundle)
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
  // npx resout `next` et `electron-builder` depuis node_modules (le PATH du
  // shell Windows ne contient pas node_modules/.bin dans un execSync).
  const loaded = loadEnvFile(envElectron)
  log(`Variables cloud chargees dans process.env (URL: ${loaded.NEXT_PUBLIC_SUPABASE_URL || 'ABSENTE !'})`)
  // Build FROM SCRATCH : un .next residuel contiendrait les NEXT_PUBLIC_*
  // inlinees avec les anciennes valeurs (ex: localhost:54321)
  fs.rmSync(path.join(root, '.next'), { recursive: true, force: true })
  log('Next build...')
  execSync('npx next build --webpack', { cwd: root, stdio: 'inherit' })

  // --- 3b. Sanitization AVANT packaging : on ne doit PAS embarquer les secrets
  // DECART_API_KEY / SUPABASE_SERVICE_ROLE_KEY en clair dans app.asar.unpacked/.env.local
  // (extractible par 7zip). NEXT_PUBLIC_* sont déjà inlinés dans .next au build,
  // le fichier embarqué ne sert que de fallback. On le réécrit sans les clés secrètes :
  // Supabase app_config est la source prioritaire (lib/decart-config.ts:71) — fallback .env
  // vide = l'app reste fonctionnelle (modif à chaud dans Supabase), mais la clé n'est plus
  // extractible du .exe.
  try {
    const raw = fs.readFileSync(envLocal, 'utf8')
    const sanitized = raw
      .split(/\r?\n/)
      .map((line) => {
        if (/^\s*DECART_API_KEY\s*=/.test(line)) return '# DECART_API_KEY= (retirée du build — fournie via Supabase app_config)'
        if (/^\s*DECART_API_KEY_NO_WATERMARK\s*=/.test(line)) return '# DECART_API_KEY_NO_WATERMARK= (retirée du build)'
        if (/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=/.test(line) && !/^\s*SUPABASE_SERVICE_ROLE_KEY\s*=\s*$/.test(line)) return 'SUPABASE_SERVICE_ROLE_KEY='
        if (/^\s*(LIVE_GPU_SHARED_SECRET|RUNPOD_API_KEY|LIVEKIT_API_SECRET|RESEND_API_KEY|PAYDUNYA_|TRYBIT_|NOWPAYMENTS_|TURNSTILE_SECRET_KEY)\s*=/.test(line)) {
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

  log('electron-builder --win...')
  execSync('npx electron-builder --win', { cwd: root, stdio: 'inherit' })
  log('BUILD TERMINE')
} catch (err) {
  console.error('\n[build-electron] ECHEC DU BUILD:', err.message)
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
