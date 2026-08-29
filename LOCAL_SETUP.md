# 🚀 ChapCam - Guide de Développement Local Complet

Ce guide vous permet de faire tourner **ChapCam entièrement en local** sur votre machine, **sans payer d'abonnement ChapCam** (points / forfaits).

## ⚠️ Gratuit ≠ swap IA magique sans coût

| Ce qui est gratuit | Ce qui ne l'est pas |
|--------------------|---------------------|
| App ChapCam en local (`NEXT_PUBLIC_FREE_LIVE_SWAP=true`) | **Decart cloud** (Lucy) = service tiers, clé API souvent payante / limitée |
| Points / abonnements désactivés | GPU cloud RunPod / Vast (si tu en loues) |
| Worker local InsightFace (open-source) si tu as un **GPU NVIDIA** | WhatsApp mobile (pas de caméra virtuelle) |

**Chemin 100 % gratuit pour le vrai face-swap :**
1. `NEXT_PUBLIC_FREE_LIVE_SWAP=true` (déjà le défaut)
2. Worker local : `scripts/live-gpu-worker/local_app.py` (GPU NVIDIA + modèles gratuits)
3. Caméra virtuelle : **OBS Virtual Camera** (chemin principal, recommandé) ou pilote akvirtualcamera
4. Dans WhatsApp **Desktop**, choisir « OBS Virtual Camera »

Sans GPU local ni Decart : l'UI marche, **mais pas de vrai swap IA**.

---

## 📋 Prérequis

| Outil | Version | Lien |
|-------|---------|------|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) |
| **Docker Desktop** | Dernière | [docker.com](https://docker.com/products/docker-desktop) |
| **Git** | Dernière | [git-scm.com](https://git-scm.com) |
| **Decart API Key** | Optionnel (cloud) | [platform.decart.ai](https://platform.decart.ai) |
| **GPU NVIDIA** | Optionnel (local 0€) | pour `scripts/live-gpu-worker` |

> **Note** : Sans clé Decart et sans worker GPU local, l'app affiche la webcam mais **ne transforme pas** le visage (le mode démo pure a été retiré du hook Lucy).

---

## ⚡ Démarrage Rapide (Recommandé)

### Option A : Script automatique (Windows PowerShell)

```powershell
# Dans le dossier du projet
cd C:\chapcam2\chapcam-kz

# Exécuter le script (démarre Docker + Supabase + Next.js)
.\start-local.ps1
```

### Option B : Commandes manuelles

```bash
# 1. Aller dans le projet
cd C:\chapcam2\chapcam-kz

# 2. Démarrer Supabase Local (Docker)
docker compose up -d

# 3. Attendre ~30-60s que tous les services soient "healthy"
docker compose ps

# 4. Installer les dépendances
npm install

# 5. Lancer Next.js
npm run dev
```

---

## 🔧 Configuration Détaillée

### 1. Variables d'environnement (`.env.local`)

Le script `start-local.ps1` crée/configure automatiquement ce fichier. Sinon, copiez manuellement :

```bash
cp .env.example .env.local
```

**Contenu minimal pour local** (mis à jour par le script) :

```env
# MODE GRATUIT - NE PAS MODIFIER
NEXT_PUBLIC_FREE_LIVE_SWAP=true

# SUPABASE LOCAL (généré par docker-compose)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# DECART AI (OPTIONNEL - pour vrai swap IA)
# Inscrivez-vous sur https://platform.decart.ai
DECART_API_KEY=votre-cle-ici
# DECART_API_KEY_NO_WATERMARK=  # Optionnel
```

### 2. Accéder à Supabase Studio (Dashboard DB)

Une fois `docker compose up -d` lancé :

| Interface | URL | Usage |
|-----------|-----|-------|
| **Studio** | http://localhost:54329 | Gérer tables, voir données, SQL Editor |
| **API Gateway** | http://localhost:54321 | Point d'entrée unique (comme en prod) |
| **Mailhog** | http://localhost:8025 | Voir emails envoyés (reset password, etc.) |

> **Identifiants Studio** : Aucune auth requise en local.

### 3. Exécuter le SQL d'initialisation (si pas fait auto)

Le fichier `supabase/init.sql` s'exécute **automatiquement** au premier `docker compose up` (monté dans `/docker-entrypoint-initdb.d/`).

Si vous devez le relancer manuellement :

```bash
# Via Docker
docker exec -i chapcam-db psql -U postgres -d postgres < supabase/init.sql

# Ou via Studio → SQL Editor → Coller le contenu de supabase/init.sql
```

---

## 🎮 Utilisation Quotidienne

### URLs Principales

| Page | URL | Description |
|------|-----|-------------|
| **Accueil** | http://localhost:3000 | Landing page |
| **Login/Register** | http://localhost:3000/auth/login | Authentification |
| **Dashboard** | http://localhost:3000/dashboard | Interface principale |
| **Live Swap** | http://localhost:3000/dashboard/live-swap | **Page de swap temps réel** |
| **Avatars** | http://localhost:3000/dashboard/avatars | Gérer vos avatars |
| **Voice Swap** | http://localhost:3000/dashboard/voice-swap | Changement de voix |

### Flux de test typique

1. Ouvrez http://localhost:3000
2. Cliquez "S'inscrire" → Créez un compte (email fictif OK en local)
3. Redirection vers `/dashboard`
4. Allez dans **Live Swap**
5. Sélectionnez un avatar (ou créez-en un)
6. Cochez "Certification d'usage responsable"
7. Cliquez **"Démarrer le Live Swap"**
8. Autorisez la caméra/micro dans le navigateur

### Mode Démo vs Mode Réel

| Indicateur | Mode Démo (sans Decart) | Mode Réel (avec Decart) |
|------------|------------------------|------------------------|
| **Badge UI** | 🟡 "MODE DÉMO LOCAL" | 🟢 "LIVE" |
| **Caméra ChapCam** | Miroir webcam locale | Flux IA transformé |
| **Latence** | ~0ms (local) | ~100-200ms (cloud) |
| **Watermark** | Aucun | Selon config Decart |
| **Points** | Illimités (999,999) | Illimités (mode gratuit) |

---

## 🐳 Commandes Docker Utiles

```bash
# Voir les containers
docker compose ps

# Voir les logs d'un service
docker compose logs -f db
docker compose logs -f kong
docker compose logs -f auth

# Redémarrer un service
docker compose restart auth

# Tout arrêter (garde les volumes/DB)
docker compose down

# Tout arrêter + supprimer volumes (DB reset)
docker compose down -v

# Rebuild complet (après modif docker-compose.yml)
docker compose up -d --build

# Shell dans la DB
docker exec -it chapcam-db psql -U postgres -d postgres
```

---

## 🗄️ Base de Données - Tables Principales

| Table | Description | Accès Studio |
|-------|-------------|--------------|
| `profiles` | Points, plan, infos user | ✅ |
| `subscriptions` | Abonnements (compat) | ✅ |
| `user_avatars` | Avatars personnalisés | ✅ |
| `live_access` | Fenêtres Live + essai | ✅ |
| `swap_transactions` | Historique swaps | ✅ |
| `swap_sessions` | Sessions en cours | ✅ |
| `voice_subscriptions` | Minutes Voice | ✅ |
| `installation_requests` | Demandes app desktop | ✅ |
| `pc_licenses` | Licences Windows à vie | ✅ |
| `wave_links` | Prix Wave (admin) | ✅ |
| `payment_requests` | Validations paiement | 🔒 (service_role) |
| `admin_logs` | Logs actions admin | 🔒 (service_role) |

---

## 🔑 Clés API Utiles (Locales)

Ces clés sont **fixes** en local (définies dans `docker-compose.yml`) :

| Clé | Valeur | Usage |
|-----|--------|-------|
| **JWT Secret** | `super-secret-jwt-token-with-at-least-32-characters-long` | Signature tokens |
| **Anon Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Client navigateur |
| **Service Role** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | API serveur (admin) |

> **Ne JAMAIS utiliser ces clés en production** - elles sont publiques ici.

---

## 🛠️ Développement - Fichiers Clés à Connaître

```
├── .env.local                 # ← VOS config locales (gitignored)
├── docker-compose.yml         # Stack Supabase local
├── supabase/
│   ├── init.sql              # Schéma DB complet (auto-exécuté)
│   └── kong.yml              # Config gateway API
├── lib/
│   ├── free-mode.ts          # 💚 CŒUR : Mode gratuit illimité
│   ├── watermark.ts          # Gestion watermark (gratuit = sans)
│   └── live-access.ts        # Logique sessions Live
├── app/api/
│   ├── decart-token/route.ts # Token Decart (mock si pas de clé)
│   ├── points/route.ts       # API points (illimité en gratuit)
│   ├── faceswap/route.ts     # Face swap photo/vidéo
│   └── live/                 # Sessions Live (heartbeat, session)
├── hooks/
│   └── use-lucy-21.ts        # Hook React swap (gère mode démo)
├── app/dashboard/live-swap/
│   └── page.tsx              # Page principale Live Swap
└── start-local.ps1           # Script démarrage Windows
```

---

## 🐛 Dépannage Courant

### ❌ "Service temporairement indisponible" sur Live Swap
**Cause** : Pas de `DECART_API_KEY` dans `.env.local`
**Solution** : 
- Soit ajoutez votre clé Decart → vrai swap IA
- Soit laissez vide → **mode démo automatique** (webcam seulement)

### ❌ "Non autorisé" / Redirection vers login
**Cause** : Clés Supabase invalides ou services pas prêts
**Solution** :
```bash
# Vérifier que les services sont healthy
docker compose ps
# Tous doivent afficher "healthy"

# Vérifier .env.local
cat .env.local | grep SUPABASE
```

### ❌ Caméra non détectée / écran noir
**Cause** : Permissions navigateur
**Solution** :
- Chrome/Edge : 🔒 cadenas à gauche de l'URL → Caméra/Micro → "Autoriser"
- Firefox : 🔒 → Permissions → "Autoriser"
- HTTPS requis pour caméra → `http://localhost:3000` OK en local

### ❌ Erreur hydration React (serveur ≠ client)
**Cause** : `isFreeLiveSwap()` lit `process.env` côté serveur
**Solution** : Déjà géré - `FREE_MODE` calculé côté client dans `page.tsx`

### ❌ Port déjà utilisé (54321, 3000, etc.)
**Solution** :
```bash
# Trouver le processus
netstat -ano | findstr :54321
# Tuer le processus (PID à la fin)
taskkill /PID <PID> /F
```

### ❌ DB corrompue / voulez reset complet
```bash
docker compose down -v
docker compose up -d
# Réattendre 30-60s
```

---

## 📱 Test sur Mobile / Autre Appareil (LAN)

1. Trouvez votre IP locale : `ipconfig` → `IPv4` (ex: `192.168.1.42`)
2. Dans `.env.local` : `NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.42:54321`
3. Autorisez le pare-feu Windows sur ports 3000, 54321-54329
4. Accédez depuis mobile : `http://192.168.1.42:3000`

> ⚠️ Caméra HTTPS requis sur mobile → utilisez `ngrok` ou `mkcert` pour HTTPS local

---

## 🎯 Obtenir une Clé Decart API (Pour Vrai Swap IA)

1. Allez sur **[platform.decart.ai](https://platform.decart.ai)**
2. Créez un compte (gratuit pour débuter)
3. Dashboard → **API Keys** → **Create New Key**
4. Copiez la clé (`sk_...`)
5. Ajoutez dans `.env.local` :
   ```env
   DECART_API_KEY=sk_votre_cle_ici
   ```
6. Redémarrez : `npm run dev` (Next.js hot-reload détecte le changement)

---

## 📦 Build Production Local

```bash
# Build Next.js
npm run build

# Test build
npm start

# Build Electron (app desktop Windows)
npm run electron:build:win
# → Sortie dans dist/
```

---

## 🔄 Workflow Git Recommandé

```bash
# 1. Créer une branche
git checkout -b feature/ma-fonctionnalite

# 2. Développer en local
# ... code ...

# 3. Test complet
npm run lint
npm run build

# 4. Commit
git add .
git commit -m "feat: description claire"

# 5. Push + PR
git push origin feature/ma-fonctionnalite
# → Ouvrir PR sur GitHub
```

---

## 📚 Ressources Utiles

- **Next.js Docs** : https://nextjs.org/docs
- **Supabase Local Dev** : https://supabase.com/docs/guides/local-development
- **Decart SDK** : https://github.com/decart-ai/sdk
- **LiveKit (WebRTC)** : https://docs.livekit.io
- **Tailwind CSS** : https://tailwindcss.com/docs

---

## ✅ Checklist "Ça marche ! Prochaines étapes"

1. **Testez l'UI** : Dashboard → Live Swap → Démarrer (mode démo)
2. **Ajoutez un avatar** : Dashboard → Avatars → "Ajouter" → Upload image
3. **Configurez Decart** : Pour le vrai swap IA
4. **Testez l'app Desktop** : Dashboard → "Demande d'installation" → Build Electron
5. **Déployez** : Push sur main → Vercel auto-deploy (configuré)

---

**Bon développement ! 🎉**

*Le mode gratuit est actif par défaut - profitez du Live Swap illimité sans payer !*

---

## 🔐 Sécurité & variables d'environnement (important)

**Aucune identifiant de production n'est codé en dur dans le code.** Depuis la
mise en dur retirée, l'app exige ces variables (sinon erreur explicite au démarrage) :

| Variable | Requis ? | Usage |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL du projet Supabase (serveur + navigateur) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Clé anon publique |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (admin) | Clé service_role, serveur uniquement |
| `DECART_API_KEY` | Pour le swap cloud | Live Swap Lucy (platform.decart.ai) |
| `DECART_API_KEY_NO_WATERMARK` | Optionnel | Rendu sans watermark |
| `LIVE_GPU_SHARED_SECRET` | Pour le GPU live | Signature HMAC des tokens worker |
| `LIVE_GPU_WS_URL` / `RUNPOD_POD_ID` | Pour le GPU live | Worker(s) WebSocket / pod RunPod |
| `RUNPOD_API_KEY` / `RUNPOD_ENDPOINT_ID` | Face swap RunPod | Endpoints serverless |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Cloud swap | Tokens LiveKit |
| `FAL_KEY` | `/api/swap` | Face swap photo fal.ai (jamais exposée au client) |
| `GENIUSPAY_API_KEY` | Paiements | Clé API publique GeniusPay (header X-API-Key) |
| `GENIUSPAY_API_SECRET` | Paiements | Clé API secrète GeniusPay (header X-API-Secret) |
| `NEXT_PUBLIC_FREE_LIVE_SWAP` | ⚠️ Prod | `false` en production pour réactiver forfaits/points |

> ⚠️ **Mode gratuit en production** : `isFreeLiveSwap()` renvoie `true` par défaut.
> En production, définissez **explicitement** `NEXT_PUBLIC_FREE_LIVE_SWAP=false`
> (sinon Live Swap + Face Swap restent gratuits et illimités, forfaits contournés).
> Un avertissement est émis dans les logs quand la variable manque en production.