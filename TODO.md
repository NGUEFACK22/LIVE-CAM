# Progression — Mise à jour setup Electron + config Decart

## ✅ Analyse Decart (terminée)
La chaîne Decart est correcte :
- `lib/decart-config.ts` : Supabase d'abord, `.env` en fallback.
- `supabase/supabase-app-config.sql` : table `app_config` + fonction `get_app_config` + nouvelle clé seedée.
- `app/api/decart-token` & `decart-session` : utilisent `resolveDecartKeys()`, modèles valides.
- `hooks/use-lucy-21.ts` : usage SDK `@decartai/sdk@0.1.14` conforme.

## 📋 Plan (option 1 : bump + rebuild)
- [x] Bump `package.json` : `1.0.11` → `1.0.12`
- [x] Harmoniser `lib/electron.ts` fallback `getAppVersion` (`1.0.10` → `1.0.12`)
- [x] Vérifier `.env.electron` contient la nouvelle `DECART_API_KEY` ✅ (prefix `dct_chapcam_`, suffix `Pdvg`, conforme à la seed SQL)
- [x] **CORRIGER le BOM UTF-8** ajouté à `package.json` + `lib/electron.ts` par PowerShell (cassait le parse JSON de Next.js : `Unexpected token '∩╗┐'`)
- [x] Lancer `npm run electron:build:win` (rebuild `.next` + copie `.env.electron` → `.env.local` + empaquetage)
- [x] Vérifier la génération de `dist/ChapCam-Setup-1.0.12.exe` (272 MB, généré à 10:12)

## 🔑 Changement de clé Decart (10/08/2026)
- [x] Nouvelle clé : `dct_chapcam_nnilEuDZOVTIehwBWZlChfSULtWsmMhDBHhnJndFxvTvZnIEclcdoBLoLYeuvGNW`
- [x] Mise à jour `.env.electron`, `.env.local`, `supabase/supabase-app-config.sql`
- [x] Clé validée : création de token `ek_...` OK (modèle `lucy-2.5`), connectivité `api.decart.ai` OK
- [x] Rebuild installateur 13:01 (271 MB) — vérifié : `.env.local` embarqué contient la NOUVELLE clé

## ✅ Vérification fonctionnalités (10/08/2026)
- [x] `tsc --noEmit` OK
- [x] `/api/live/access` → 200 (canStart, mode free)
- [x] `/api/points` → 200 (999999 pts, mode gratuit)
- [x] `/api/decart-token` → 200 (token Decart créé)
- [x] `/api/decart-session` → 200 (token session créé)
- [x] Pages dashboard (live-swap, avatars, settings, plans, virtual-camera, etc.) → 200
- [x] Pages publiques (`/`, `/auth/login`, `/download`, `/desktop`, `/numbers`, ...) → 200
- [x] Login/signup Supabase → OK
- [x] Routes admin protégées → 401 (attendu sans session admin)
- ⚠️ `app/api/test-decart/route.ts` → 404 en dev Turbopack (route de diagnostic uniquement, présente au build prod)

## ⚠️ Action requise utilisateur
Pour que les apps desktop DÉJÀ INSTALLÉES récupèrent la nouvelle clé sans rebuild, exécuter
`supabase/supabase-app-config.sql` dans le dashboard Supabase cloud (table `app_config`).
Sans cela, seul le nouvel installateur (13:01) utilise la nouvelle clé.
