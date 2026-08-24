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

---

## 📦 Bump 1.0.13 (14/08/2026)

### Changements
- [x] Bump `package.json` : `1.0.12` → `1.0.13`
- [x] Harmoniser `lib/electron.ts` fallback `getAppVersion` → `1.0.13`

### Nouvelles fonctionnalités
- **Journal de diagnostic (écran noir)** : Capture automatique des logs renderer dans `chapcam-debug.log` (userData). Bouton "Diagnostic" dans Live Swap copie les logs dans le presse-papiers.
  - `electron/main.js` : `initDebugLog()`, `writeDebugLog()`, `clearDebugLogFile()`
  - `electron/preload.js` : `getDebugLog()`, `clearDebugLog()`
  - `app/dashboard/live-swap/page.tsx` : bouton Diagnostic avec AlertTriangle
  - `lib/electron.ts` : types `getDebugLog?`, `clearDebugLog?`

### Corrections de bugs
- **Fermetures perimées (stale closures)** dans les hooks :
  - `hooks/use-cloud-swap.ts` : refs pour `processFrame`, `disconnect`, `status` — évite que `setInterval` et `cleanup` utilisent des versions datées
  - `hooks/use-live-face-swap.ts` : ref pour `captureLoop` — corrige la boucle rAF qui bouclait avec un WS fermé
  - `hooks/use-lucy-21.ts` : `connectRef` et `startVirtualCameraRef` assignés via `useEffect` (pas pendant le rendu)
- **Hooks React** :
  - `components/theme-toggle.tsx` : `useSyncExternalStore` pour `mounted` (évite un flash SSR)
  - `components/ui/sidebar.tsx` : `useState` au lieu de `useMemo` pour la largeur aléatoire du skeleton
  - `components/ui/use-mobile.tsx` / `hooks/use-mobile.ts` : état initial synchronisé via `window.innerWidth`
  - `hooks/use-voice-subscription.ts` : cleanup du fetch avec flag `active`
  - `components/turnstile-widget.tsx` : callbacks dans `useEffect` (pas pendant le rendu)
- **LiveKit** : `lib/livekit/client.ts` déconnecte le room precedent avant d'en ouvrir un nouveau
- **Virtual Camera** : `hooks/use-virtual-camera.ts` détection synchrone de disponibilité

### Build
- [x] Lancer `npm run electron:build:win` → `dist/ChapCam-Setup-1.0.13.exe`
- [x] Vérifier taille et signature

---

## 🔧 Session 16/08/2026 — Corrections live swap (flux noir + hydration + analytics)

### Problème signalé
« Le flux transformé est arrivé vide (écran noir). Nouvelle tentative 2/3 dans 10 s… »
(le retry borné fonctionnait, mais le flux noir persistait).

### Causes trouvées dans le journal de diagnostic (`chapcam-debug.log`)

**1. Flux noir : la détection tuait la session pendant la CHAUFFE du modèle**
- Le journal montrait : connexion Decart OK, flux transformé **arrivé avec de vraies
  dimensions (1280x720, donc décodable)**, mais tué ~0,7 s plus tard « Flux transforme
  NOIR detecte ».
- Cause : `isStreamBlack()` prenait le **MINIMUM** des luminance sur 4 frames échantillonnées
  ~800 ms. Or les PREMIÈRES frames après connexion sont toujours noires le temps que le
  modèle se réchauffe (2-10 s, TTFF du SDK). Une seule frame noire suffisait → la session
  était tuée en plein démarrage du modèle, puis relancée → boucle.
- Correctif `hooks/use-lucy-21.ts` :
  - `isStreamBlack` : attend jusqu'à **10 s**, noir seulement si **TOUTES** les frames sont
    noires ; dès qu'une frame lumineuse apparaît → réponse immédiate (non noir).
  - Verrou `blackCheckInFlightRef` : le `requestVideoFrameCallback` se déclenche à chaque
    frame — sans verrou, chaque frame noire lançait un nouveau watcher et les retries
    étaient comptés en double (abandon prématuré).
  - `CONNECT_TIMEOUT_MS` 20 s → **30 s** (flux ~16 s + chauffe modèle jusqu'à 10 s).

**2. React #418 (hydration mismatch) à CHAQUE chargement de l'app**
- Cause : `hooks/use-virtual-camera.ts` détectait Electron **synchronement dans `useState`**
  (`isElectron()` lit `window.electronAPI`). Le serveur Next (SSR) rend `available=false`,
  le client Electron rend `available=true` au premier rendu → mismatch → #418.
- Correctif : détection **après montage** (`useEffect` différé d'un tick), état initial
  `false` identique SSR/client. Le garde `typeof api.virtualCamera?.status === 'function'`
  (anti-crash anciennes versions) est conservé.

**3. Script `/_vercel/insights/script.js` refusé (MIME)**
- Cause : `AnalyticsProvider` détectait Electron avec `setTimeout(0)`, mais le `useEffect`
  de l'enfant `<Analytics>` (qui injecte le `<script>`) s'exécutait AVANT le timer du parent.
- Correctif : détection **synchrone dans l'initialiseur de `useState`** (le preload expose
  `window.electronAPI` avant le premier rendu) → le script n'est jamais injecté en Electron.

**4. `components/chapcam-pc/pc-countdown.tsx`** : `useState(getRemaining())` avec `Date.now()`
   → mismatch SSR/client. Correctif : démarre à `null`, calcul après montage.

---

## 🔧 Session 16/08 après-midi — « ça s'arrête tout seul comme si ça se rafraîchissait »

### Problème signalé (test win-unpacked sans installation)
« Ça fonctionne mais ça s'arrête tout seul, comme si ça se rafraîchissait. »

### Causes trouvées dans le journal (session 11:34-11:36)

**1. Faux « flux noir » tuant une session QUI FONCTIONNAIT (11:35:10 → 11:35:22)**
- Le flux transformé arrivait et était **affiché** (`source trouvee dims=1280x720`, dims qui
  évoluent 1280→640→320 = l'avatar est visible), puis notre watcher concluait NOIR 12 s
  plus tard → kill → reconnexion → l'avatar revenait → « ça se rafraîchit » en boucle.
- Cause : `isStreamBlack` créait un **2e élément `<video>` séparé** avec le même MediaStream
  pour mesurer les pixels. Ce double ne décode souvent **JAMAIS** de frames (le flux
  WebRTC/LiveKit est déjà consommé par l'élément affiché) → `drawImage` rendait du NOIR en
  permanence → faux « flux noir » alors que l'avatar était parfaitement visible.
- Correctif : `isElementBlack(el)` mesure **l'élément video réellement affiché**
  (`remoteVideoRef`, celui qui peint les frames), pas un doublon du stream.

**2. Le SDK Decart se déconnectait seul, sans aucune réaction du hook (11:35:47)**
- 2e tentative : `connected` à 11:35:44 → `could not determine track dimensions` (warn
  publication locale) → `disconnect from room` + `websocket closed` à 11:35:47-48 →
  **plus aucun log** : ni retry, ni erreur, ni ConnectionState → UI figée en « connexion ».
- Cause : `await client.realtime.connect(...)` est resté **pendu** (le SDK retente en
  interne pendant 30-60 s), donc le `connectTimeoutRef` — défini **APRÈS** l'await — n'était
  **jamais posé**, et les handlers (`connectionChange`) jamais attachés.
- Correctif `hooks/use-lucy-21.ts` :
  - `connectTimeoutRef` défini **AVANT** `await client.realtime.connect(...)` → toute
    tentative est toujours bornée, même si connect() pend.
  - Handler `connectionChange` : réagit aussi aux états `failed/disconnected/closed`
    **avant la 1re frame** (retry borné au lieu du silence).
  - Retry factorisé dans `scheduleAutoRetry(avatarImageUrl, msg, msgFinal)` — utilisé par
    le timeout, le watcher noir, le connectionChange et le catch capacité (un seul timer
    à la fois, garde `retryTimerRef`).

### Build
- [x] Lint + `tsc --noEmit` OK sur tous les fichiers modifiés
- [x] Rebuild 13:23 → `dist/ChapCam-Setup-1.0.13.exe`

---

## 🔧 Session 16/08 soir — « écran noir complet sans message d'erreur »

### Problème signalé
Après installation du build 13:23, « ça ne fonctionne plus rien, écran noir complet et sans
message d'erreur ».

### Analyse du journal (session win-unpacked 13:29-13:30)
- 13:29:54 connecté → le flux arrivait et **fonctionnait** (OBS pixels visibles, capture 320x180)
- **13:30:57 « Page leave detected, disconnecting »** → la PAGE s'est déchargée (livekit
  réagit à pagehide/beforeunload/**freeze**) → session tuée → puis PLUS AUCUN log renderer
- L'utilisateur relançait ensuite (14:25) pendant que MON instance de test (13:37) occupait
  le port 3000 → sa fenêtre ne chargeait rien → écran noir complet sans message

### Causes corrigées (`main.js` + `electron/main.js`)

**1. `did-fail-load` rechargeait la page pour n'importe quelle ressource secondaire**
- Le handler se déclenche pour CHAQUE frame (image, script, favicon, font). Sans filtre
  `isMainFrame`, l'échec d'une simple ressource rechargeait TOUTE la page vers `validatedURL`
  (l'URL de la ressource cassée !) → échec → nouveau did-fail-load → **boucle de
  rechargements → écran noir**, et chaque rechargement tuait la session live swap
  (« Page leave detected »).
- Correctif : `if (!event.isMainFrame) return` + recharger la PAGE
  (`/dashboard/live-swap`), jamais `validatedURL`.

**2. `backgroundThrottling` manquant → Chromium peut GELER la page en arrière-plan**
- livekit écoute l'événement `freeze` (Page Lifecycle) → dès que Chromium gèle la page
  (fenêtre cachée, veille Windows), il se déconnecte → « Page leave detected » → session
  tuée alors que l'utilisateur est juste passé sur une autre fenêtre.
- Correctif : `backgroundThrottling: false` dans les webPreferences de la fenêtre principale.

**3. Journal de diagnostic aveugle sur le processus principal**
- `chapcam-debug.log` ne capturait QUE les logs du renderer. Les logs du MAIN process
  (démarrage/relance du serveur Next, did-fail-load, rechargements) partaient sur stdout
  et étaient INVISIBLES → impossible de diagnostiquer.
- Correctif : `log()` écrit aussi dans le fichier + sorties stdout/stderr du serveur Next
  (`[next]` / `[next-error]`).

### Point important pour l'utilisateur
- L'app **installée** dans `C:/Program Files/ChapCam` date de **04:57** (ancien build,
  sans les correctifs du flux noir !). Le raccourci bureau pointe dessus → il faut
  RÉINSTALLER le nouveau setup (ou lancer `dist/win-unpacked/ChapCam.exe`).

### Build
- [x] Reconstruire `dist/ChapCam-Setup-1.0.13.exe` avec les 3 correctifs ci-dessus

---

## ✅ Vérification 19/08/2026 — le rebuild contient bien les correctifs

Rebuild `dist/ChapCam-Setup-1.0.13.exe` effectué le 17/08 à 05:03 (282 MB).
Vérifications (19/08) :
- L'asar empaqueté (`dist/win-unpacked/resources/app.asar`) contient :
  - [x] `backgroundThrottling: false` (fix gel en arrière-plan)
  - [x] filtre `isMainFrame` dans `did-fail-load` (fix boucle rechargements)
  - [x] journalisation main + serveur Next dans `chapcam-debug.log` (`[next]` / `[next-error]`)
- Le bundle `.next` (`app.asar.unpacked/.next`, BUILD_ID du 17/08 04:54) :
  - [x] ne contient plus le double lancement OBS depuis la page
    (`vcamLaunchObs`/`vcamStart` dans live-swap/page.tsx retirés le 17/08 04:18)
- `.env.local` empaqueté :
  - [x] clé Decart `dct_chapcam_nnilEu...` présente
  - [x] Supabase CLOUD (`ojmzqokffbptmcktnwdy.supabase.co`), pas localhost
- [x] `npm run lint` OK (0 erreur)
- [x] `npx tsc --noEmit` OK (0 erreur)
- Note : `main.js` (racine) et `electron/main.js` sont identiques ; le
  `package.json` pointe sur `electron/main.js` (celui empaqueté).

## ⚠️ Action requise utilisateur (19/08)
- L'app installée dans `C:/Program Files/ChapCam` doit être réinstallée avec
  `dist/ChapCam-Setup-1.0.13.exe` (build 19/08 16:10) — l'ancienne installation
  date du matin du 17/08 et ne contient que les derniers correctifs si elle a
  été faite après 05:03.
- Pour les apps desktop déjà installées ailleurs : exécuter
  `supabase/supabase-app-config.sql` dans le dashboard Supabase cloud pour
  propager la nouvelle clé Decart sans rebuild.

---

## 🔧 Session 19/08 — Fin du démarrage AUTO du mode Stream + caméra virtuelle

### Demande
« Quand je lance le live swap, je ne veux plus que le mode streaming
se lance automatiquement. »

### Corrections
- **`app/dashboard/live-swap/page.tsx`** : suppression du `useEffect`
  « STREAM MODE AUTO » qui forçait `streamMode=true` dès la connexion.
  Le mode Stream est maintenant MANUEL : bouton « Stream » pour l'activer,
  bouton « Quitter Stream » ou Echap pour en sortir.
- **`hooks/use-lucy-21.ts`** : suppression du démarrage automatique de la
  caméra virtuelle/OBS dans `onRemoteStream` (`startVirtualCameraRef`).
  C'est ce double démarrage automatique qui provoquait les boucles
  kill/relance OBS (~60 s de sortie noire) du 16/08. La caméra virtuelle
  s'active désormais manuellement via l'indicateur / page Caméra virtuelle.
- **`hooks/use-virtual-camera.ts`** : corrections des erreurs de syntaxe
  (`?.status?` → `?.status?.()`, `.catch(() -> {})` → `.catch(() => {})`)
  et ré-implémentation de `detectObsAvailability` via l'IPC `status()`
  existant (le main n'exposait pas d'IPC dédié).
- **`components/live/virtual-camera-indicator.tsx`** : remise de la note
  « Pour WhatsApp » DANS son conteneur `relative` (elle s'ancrait ailleurs),
  nettoyage des variables non utilisées.

### Build
- [x] Lint + `tsc --noEmit` OK
- [x] Rebuild 16:10 → `dist/ChapCam-Setup-1.0.13.exe` (281,8 MB)
- [x] Vérifié : l'ancien code auto-stream/auto-OBS est absent du bundle,
  clé Decart + Supabase cloud embarqués, `.env.local` de dev restauré
