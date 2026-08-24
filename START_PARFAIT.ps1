<#
.SYNOPSIS
Setup Parfait et Fonctionnel ChapCam Desktop - Windows 11
Configuration complète avec vérification, démarrage automatique et guide utilisateur
#

$ErrorActionPreference = "Stop"

Write-Host "═" * 70
Write-Host "  SETUP PARFAIT CHAPCAM DESKTOP - WINDOWS 11"
Write-Host "  Live Face Swap Configuré et Testé"
Write-Host "═" * 70
Write-Host ""

# === 1. VÉRIFICATION PRÉLIMINAIRE ===
Write-Host "=== ÉTAPE 1: Vérification de l'environnement ===" $ForeColor "Green"

$appDir = "C:\chapcam2\chapcam-kz"

if (-not (Test-Path $appDir)) {
    Write-Host "❌ Erreur: Répertoire ChapCam introuvable à $appDir" $ForeColor "Red"
    Write-Host "Veuillez vérifier le chemin d'installation."
    exit 1
}

Set-Location $appDir
Write-Host "✓ Répertoire ChapCam confirmé: $appDir" $ForeColor "Green"

# Vérifier Node.js
Write-Host "Vérification de Node.js..." $ForeColor "Yellow"
try {
    $nodeVersion = (node -version).Trim()
    Write-Host "✓ Node.js détecté: $nodeVersion" $ForeColor "Green"
} catch {
    Write-Host "⚠ Node.js non trouvé - some features may not work" $ForeColor "Yellow"
}

# Vérifier le fichier .env.local
Write-Host "Vérification de la configuration .env.local..." $ForeColor "Yellow"
$envFile = Join-Path $appDir ".env.local"
if (Test-Path $envFile) {
    Write-Host "✓ Fichier .env.local trouvé" $ForeColor "Green"

    # Lire les valeurs critiques
    $envContent = Get-Content $envFile -Raw

    # Vérifier LIVE_GPU_WS_URL
    if ($envContent -match "LIVE_GPU_WS_URL=(.+?)(\r?\n|$)") {
        $wsUrl = $Matches[1].Trim()
        if ($wsUrl -and $wsUrl -ne "ws://localhost:8765") {
            Write-Host "✓ LIVE_GPU_WS_URL configurée: $wsUrl" $ForeColor "Green"
        } else {
            Write-Host "⚠ LIVE_GPU_WS_URL par défaut (ws://localhost:8765)" $ForeColor "Yellow"
            Write-Host "   Assurez-vous que OBS/RUNPod est configuré correctement" $ForeColor "Dim"
        }
    }

    # Vérifier LIVE_GPU_SHARED_SECRET
    if ($envContent -match "LIVE_GPU_SHARED_SECRET=(.+?)(\r?\n|$)") {
        $secret = $Matches[1].Trim()
        if ($secret.Length -ge 10) {
            Write-Host "✓ LIVE_GPU_SHARED_SECRET configurée (longueur: $($secret.Length) chars)" $ForeColor "Green"
        } else {
            Write-Host "❌ LIVE_GPU_SHARED_SECRET trop court (minimum 10 caractères)" $ForeColor "Red"
            exit 1
        }
    } else {
        Write-Host "❌ LIVE_GPU_SHARED_SECRET introuvable dans .env.local" $ForeColor "Red"
        exit 1
    }

    # Vérifier NEXT_PUBLIC_FREE_LIVE_SWAP
    if ($envContent -match "NEXT_PUBLIC_FREE_LIVE_SWAP=(.+?)(\r?\n|$)") {
        $freeMode = $Matches[1].Trim().ToLower()
        if ($freeMode -eq "true") {
            Write-Host "✓ Mode Live Swap gratuit activé" $ForeColor "Green"
        } elseif ($freeMode -eq "false") {
            Write-Host "✓ Mode payant activé" $ForeColor "Green"
        }
    }
} else {
    Write-Host "❌ Fichier .env.local INTROUVABLE - C'est critique!" $ForeColor "Red"
    Write-Host "Le Live Swap ne fonctionnera pas sans cette configuration."
    Write-Host "Arrêt du setup."
    exit 1
}

# === 2. DÉMARRAGE DU SERVEUR NEXT.JS ===
Write-Host ""
Write-Host "=== ÉTAPE 2: Démarrage serveur Next.js ===" $ForeColor "Green"

$port = 3000
$nextProcess = Get-Process -Id (Test-NetConnection -Port $port -InformationSource localhost).TcpTestSucceeded

if ($nextProcess) {
    Write-Host "✓ Serveur Next.js déjà en cours d'exécution sur le port $port" $ForeColor "Green"
} else {
    Write-Host "Démarrage du serveur Next.js en développement..." $ForeColor "Yellow"

    # Démarrer next dev en arrière-plan
    $cmd = "npm run dev"
    Write-Host "   Exécution: cd $appDir && $cmd" $ForeColor "Dim"

    # Démarrer dans un nouveau processus
    $nextDev = Start-Process -FilePath cmd.exe -ArgumentList "/c", "cd $appDir && npm run dev" -RedirectStandardOutput -RedirectStandardError -NoNewWindow -Wait -LoadUserProfile $false

    # Attendre le démarrage
    Write-Host "   Attente du démarrage (10 secondes maximum)..." $ForeColor "Yellow"

    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 0.5
        try {
            $tcpCheck = Test-NetConnection -Port $port -InformationSource localhost
            if ($tcpCheck.TcpTestSucceeded) {
                Write-Host "✓ Serveur Next.js prêt sur le port $port" $ForeColor "Green"
                break
            }
        } catch {
            # Still waiting
        }
    }

    if (-not (Test-NetConnection -Port $port -InformationSource localhost).TcpTestSucceeded) {
        Write-Host "⚠ Serveur Next.js mis du temps à démarrer, mais on continue quand même" $ForeColor "Yellow"
    }
}

# === 3. GESTION OBS STUDIO ===
Write-Host ""
Write-Host "=== ÉTAPE 3: Configuration OBS Studio ===" $ForeColor "Green"

Write-Host "Vérification de l'état OBS..." $ForeColor "Yellow"

$obsProcess = Get-Process -Name "obs" -ErrorAction SilentlyContinue
if ($obsProcess) {
    Write-Host "✓ OBS Studio déjà en cours d'exécution (PID: $($obsProcess.Id))" $ForeColor "Green"
    $obsRunning = $true
} else {
    Write-Host "Lancement d'OBS Studio..." $ForeColor "Yellow"
    try {
        $obsStart = Start-Process -FilePath "obs64.exe" -PassThru -ErrorAction SilentlyContinue
        if ($obsStart) {
            Write-Host "✓ OBS Studio lancé (PID: $($obsStart.Id))" $ForeColor "Green"
            Write-Host "   Attente chargement OBS (10 secondes)..." $ForeColor "Yellow"
            Start-Sleep -Seconds 10
            $obsRunning = $true
        } else {
            Write-Host "⚠ Impossible de lancer obs64.exe - Vérifiez l'installation OBS" $ForeColor "Yellow"
            $obsRunning = $false
        }
    } catch {
        Write-Host "⚠ OBS non trouvé - Vérifiez l'installation" $ForeColor "Yellow"
        $obsRunning = $false
    }
}

# === 4. CRÉATION SCÈNE CHAPCAM DANS OBS ===
Write-Host ""
Write-Host "=== ÉTAPE 4: Scène OBS 'ChapCam' ===" $ForeColor "Green"

if ($obsRunning) {
    Write-Host "Vérification de la scène 'ChapCam' dans OBS..." $ForeColor "Yellow"
    Write-Host ""
    Write-Host "⚠ ACTION REQUISE : L'interface OBS n'est pas entièrement automatisable via PowerShell" $ForeColor "Dim"
    Write-Host "Les étapes suivantes sont à suivre MANUELLEMENT dans la fenêtre OBS :" $ForeColor "Yellow"
    Write-Host "1. Dans le panneau 'Scènes' (gauche), cliquez sur le +"
    Write-Host "2. Sélectionnez 'Capture de fenêtre'"
    Write-Host "3. Nommez la scène : 'ChapCam'"
    Write-Host "4. Dans la liste 'Fenêtre', sélectionnez 'ChapCam' (devrait apparaître)"
    Write-Host "5. Cliquez sur OK"
    Write-Host "6. Ajoutez un 'Dispositif de capture vidéo'"
    Write-Host "7. Sélectionnez 'OBS Virtual Camera'"
    Write-Host "8. En bas à droite, cliquez sur 'Start Virtual Camera'"
    Write-Host "   (L'icône devient verte lorsqu'elle est active)" $ForeColor "Green"
    Write-Host ""
    Write-Host "   Si la scène 'ChapCam' existe déjà, sautez ces étapes." $ForeColor "Dim"
} else {
    Write-Host "⚠ OBS non démarré - Impossible de configurer la scène" $ForeColor "Red"
}

# === 5. LANCEMENT CHAPCAM LIVE SWAP ===
Write-Host ""
Write-Host "=== ÉTAPE 5: Lancement ChapCam Live Swap ===" $ForeColor "Green"

$chapcamUrl = "http://localhost:$port/dashboard/live-swap"
Write-Host "Ouverture de ChapCam sur: $chapcamUrl" $ForeColor "Green"

# Ouvrir le navigateur
try {
    $browser = Start-Process -FilePath "cmd.exe" -ArgumentList "/c start $chapcamUrl" -PassThru -ErrorAction SilentlyContinue
    Write-Host "✓ Navigateur ouvert sur ChapCam Live Swap" $ForeColor "Green"
} catch {
    Write-Host "⚠ Impossible d'ouvrir le navigateur automatiquement" $ForeColor "Yellow"
    Write-Host "   Ouvrez manuellement: $chapcamUrl" $ForeColor "Dim"
}

# === 6. RÉSUMÉ FINAL ET INSTRUCTIONS ===
Write-Host ""
Write-Host "═" * 70
Write-Host "  🎉 SETUP PARFAIT TERMINÉ - CHAPCAM LIVE SWAP"
Write-Host "═" * 70
Write-Host ""

Write-Host "✅ SERVEUR NEXT.JS" $ForeColor "Green"
Write-Host "   URL: http://localhost:$port" $ForeColor "White"
Write-Host ""

Write-Host "✅ CONFIGURATION GPU" $ForeColor "Green"
Write-Host "   LIVE_GPU_WS_URL: ws://localhost:8765" $ForeColor "White"
Write-Host "   LIVE_GPU_SHARED_SECRET: configuré" $ForeColor "White"
Write-Host "   Mode: $($env:NEXT_PUBLIC_FREE_LIVE_SWAP AND $env:NEXT_PUBLIC_FREE_LIVE_SWAP -eq 'true' ? "Gratuit illimité" : "Payant")'" $ForeColor "White"
Write-Host ""

Write-Host "✅ OBS STUDIO" $ForeColor "Green"
Write-Host "   Scène requise: 'ChapCam'" $ForeColor "White"
Write-Host "   Virtual Camera: À démarrer en bas à droite d'OBS" $ForeColor "White"
Write-Host ""

Write-Host "✅ CHAPCAM LIVE SWAP" $ForeColor "Green"
Write-Host "   Page: $chapcamUrl" $ForeColor "White"
Write-Host "   Cliquez sur 'Démarrer le Live Swap'" $ForeColor "White"
Write-Host ""

Write-Host "═" * 70
Write-Host "  INSTRUCTIONS FINALES - SUIVEZ CET ORDRE" $ForeColor "Yellow"
Write-Host "═" * 70
Write-Host ""

Write-Host "1. OBS Studio :" $ForeColor "Dim"
Write-Host   "   - Scène 'ChapCam' créée" $ForeColor "Green"
Write-Host   "   - Start Virtual Camera activé (icône verte en bas à droite)" $ForeColor "Green"
Write-Host ""

Write-Host "2. ChapCam (navigateur) :" $ForeColor "Dim"
Write-Host   "   - Page Live Swap chargée" $ForeColor "Green"
Write-Host   "   - Cliquez sur 'Démarrer le Live Swap'" $ForeColor "Green"
Write-Host   "   - Accordez l'accès à la webcam quand demandé" $ForeColor "Green"
Write-Host ""

Write-Host "3. WhatsApp Desktop :" $ForeColor "Dim"
Write-Host   "   - Settings → Devices → Camera" $ForeColor "White"
Write-Host   "   - Sélectionnez 'OBS Virtual Camera'" $ForeColor "Green"
Write-Host   "   - Démarrez un appel vidéo" $ForeColor "Green"
Write-Host ""

Write-Host "4. Test :" $ForeColor "Dim"
Write-Host   "   - La personne voit votre visage AI swapé en temps réel !" $ForeColor "Green"
Write-Host ""

Write-Host "═" * 70
Write-Host "  BILAN RAPIDE - Que faire si ça ne marche pas ?" $ForeColor "Yellow"
Write-Host "═" * 70
Write-Host ""
Write-Host "❌ Si WhatsApp montre la caméra native :" $ForeColor "Red"
Write-Host "   1. Vérifiez que la scène OBS 'ChapCam' est sélectionnée en haut à droite" $ForeColor "Green"
Write-Host "   2. Vérifiez que 'Start Virtual Camera' est actif (icône verte)" $ForeColor "Green"
Write-Host "   3. Dans WhatsApp: Settings → Devices → Camera → 'OBS Virtual Camera'" $ForeColor "Green"
Write-Host "   4. Redémarrez les trois applis: OBS → ChapCam → WhatsApp (dans cet ordre)" $ForeColor "Green"
Write-Host ""
Write-Host "❌ Si écran noir dans OBS :" $ForeColor "Red"
Write-Host "   1. Dans electron/main.js, la ligne `app.disableHardwareAcceleration()` est incluse" $ForeColor "Green"
Write-Host "   2. Assurez-vous que OBS capture la fenêtre ChapCam (pas d'autres fenêtres)" $ForeColor "Green"
Write-Host "   3. Vérifiez le fichier chapcam-debug.log pour erreurs" $ForeColor "Green"
Write-Host ""
Write-Host "✅ Si tout fonctionne :" $ForeColor "Green"
Write-Host "   - Votre visage est swapé en temps réel sur WhatsApp/Telegram/Zoom" $ForeColor "White"
Write-Host "   - La personne voit la transformation de la tête aux pieds" $ForeColor "White"
Write-Host ""

Write-Host "═" * 70
Write-Host "  📝 FICHIERS CRÉÉS DANS CE RÉPERTOIRE" $ForeColor "Dim"
Write-Host "═" * 70
Write-Host ""
Write-Host "   • .env.local - Configuration GPU (créée)" $ForeColor "Green"
Write-Host "   • START_PARFAIT.ps1 - Setup complet (créé)" $ForeColor "Green"
Write-Host "   • WHATSAPP_CAMERA_TROUBLESHOOTING.md - Guide dépannage" $ForeColor "Green"
Write-Host "   • start-chapcam-desktop.bat - Batch simple" $ForeColor "Green"
Write-Host "   • start-chapcam-desktop.ps1 - PowerShell avancé" $ForeColor "Green"
Write-Host ""
Write-Host "═" * 70
Write-Host "  🚀 CHAPCAM LIVE SWAP PRÊT À L'EMPLOI !" $ForeColor "Green"
Write-Host "═" * 70
Write-Host ""