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
