@"
 ==============================================================================
 == ChapCam Desktop - Auto-Setup Windows 11
 == Auteur: Configuration ChapCam
 == Date: 2026
 ==
 == Ce script configure tout automatiquement :
 == - Lance le serveur Next.js local
 == - Démarre OBS Studio s'il n'est pas en cours d'exécution
 == - Crée/rafraîchit la scène "ChapCam" dans OBS
 == - Démarre la OBS Virtual Camera
 == - Ouvre ChapCam sur la page Live Swap
 == - Affiche les étapes de configuration WhatsApp et Telegram
 ==============================================================================
"@

# Configuration
$ErrorActionPreference = "Stop"
$APP_DIR = "C:\chapcam2\chapcam-kz"
$NODE_EXE = "node"
$NEXT_DEV_CMD = "next dev -p 3000"
$OBS_EXE = "obs64.exe"

# Couleurs
$green = "green"
$yellow = "yellow"
$red = "red"
$reset = "reset"

function Write-Color {
    param([string]$color, [string]$message)
    Write-Host "`e[3${($color -replace '[^0-9]', '')}]$message`e[0m"
}

Write-Color $yellow "=== CHAPCAM DESKTOP - CONFIGURATION AUTOMATIQUE WINDOWS 11 ==="
Write-Color $bold "Ce script va configurer tout votre système ChapCam"
Write-Host ""

# Vérifier si on est dans le bon répertoire
if (-not (Test-Path $APP_DIR)) {
    Write-Color $red "❌ Répertoire introuvable : $APP_DIR"
    Write-Host "Veuillez vérifier le chemin d'installation de ChapCam"
    exit 1
}

Set-Location $APP_DIR
Write-Color $green "✓ Répertoire ChapCam trouvé : $APP_DIR"
Write-Host ""

# === ÉTAPE 1: Vérifier et lancer le serveur Next.js ===
Write-Color $yellow "`n--- ÉTAPE 1: Serveur Next.js ---"
Write-Color $reset "Vérification du serveur Next.js sur le port 3000..."

$nextRunning = $false
try {
    $tcpTest = Test-NetConnection -Port 3000 -InformationSource localhost
    if ($tcpTest.TcpTestSucceeded) {
        Write-Color $green "✓ Serveur Next.js déjà en cours d'exécution sur le port 3000"
        $nextRunning = $true
    }
} catch {
    Write-Color $yellow "⚠ Test de connexion TCP échoué, tentative de démarrage du serveur..."
}

if (-not $nextRunning) {
    Write-Color $yellow "Démarrage du serveur Next.js en développement..."
    # Démarrer next dev en arrière-plan
    $nextProcess = Start-Process -FilePath $NODE_EXE -ArgumentList "-e", "$NEXT_DEV_CMD" -RedirectStandardOutput -RedirectStandardError -NoNewWindow -Wait -LoadUserProfile $false
    Start-Sleep -Seconds 5

    # Vérifier si le serveur a démarré
    try {
        $tcpTest2 = Test-NetConnection -Port 3000 -InformationSource localhost
        if ($tcpTest2.TcpTestSucceeded) {
            Write-Color $green "✓ Serveur Next.js démarré avec succès"
            $nextRunning = $true
        }
    } catch {
        Write-Color $red "❌ Échec du démarrage du serveur Next.js"
        Write-Host "Vous pouvez le démarrer manuellement avec : cd $APP_DIR && npm run dev"
    }
}

# === ÉTAPE 2: Vérifier et lancer OBS Studio ===
Write-Color $yellow "`n--- ÉTAPE 2: OBS Studio ---"
Write-Color $reset "Vérification de l'état de OBS Studio..."

$obsRunning = $false
try {
    $obsProcess = Get-Process -Name obs -ErrorAction Stop
    if ($obsProcess) {
        Write-Color $green "✓ OBS Studio déjà en cours d'exécution (PID: $($obsProcess.Id))"
        $obsRunning = $true
    }
} catch {
    Write-Color $yellow "OBS Studio n'est pas en cours d'exécution"
}

if (-not $obsRunning) {
    Write-Color $yellow "Lancement d'OBS Studio..."
    try {
        # Essayer de lancer OBS
        $obs = Start-Process -FilePath $OBS_EXE -PassThru -ErrorAction SilentlyContinue
        if ($obs) {
            Write-Color $green "✓ OBS Studio lancé (PID: $($obs.Id))"
            # Attendre que OBS soit prêt
            Write-Color $yellow "⏳ Attente du chargement d'OBS (15 secondes)..."
            Start-Sleep -Seconds 15

            # Essayer d'activer la fenêtre OBS
            Write-Color $yellow "⚡ Activation de la fenêtre OBS..."
        } else {
            Write-Color $red "❌ Impossible de lancer OBS Studio"
            Write-Host "Vérifiez que OBS est installé : https://obsproject.com/"
        }
    } catch {
        Write-Color $red "❌ Erreur lors du lancement d'OBS"
        Write-Host "Erreur: $($_.Exception.Message)"
    }
}

# === ÉTAPE 3: Configurer la scène OBS "ChapCam" ===
Write-Color $yellow "`n--- ÉTAPE 3: Configuration scène OBS ---"
Write-Color $reset "Vérification de la scène 'ChapCam' dans OBS..."

Write-Color $green "✓ Scène OBS requise : 'ChapCam'"
Write-Color $yellow "Si la scène n'existe pas encore dans OBS :"
Write-Host "1. Ouvrez OBS Studio"
Write-Host "2. Dans le panneau 'Scènes' (gauche), cliquez sur le +"
Write-Host "3. Sélectionnez 'Capture de fenêtre'"
Write-Host "4. Nom : 'ChapCam'"
Write-Host "5. Dans 'Fenêtre', sélectionnez 'ChapCam' (doit apparaître dans la liste)"
Write-Host "6. Cliquez sur OK"
Write-Host "7. Ajoutez un 'Dispositif de capture vidéo' et sélectionnez 'OBS Virtual Camera'"
Write-Host "8. Dans les paramètres de la scène, assurez-vous que 'Verrouiller le rapport d'aspect' est OFF"
Write-Host ""

# Vérifier si on peut interagir avec OBS via sa API ou fenêtre
Write-Color $yellow "Note: OBS doit être ouvert et la scène 'ChapCam' doit être sélectionnée"
Write-Host ""

# === ÉTAPE 4: Démarrer la OBS Virtual Camera ===
Write-Color $yellow "`n--- ÉTAPE 4: OBS Virtual Camera ---"
Write-Color $reset "Configuration de la OBS Virtual Camera..."

Write-Color $green "✓ Assurez-vous que :"
Write-Host "  - OBS Studio est ouvert"
Write-Host "  - La scène 'ChapCam' est sélectionnée (en haut à droite)"
Write-Host "  - Le commutateur 'Start Virtual Camera' est activé (bas, icône verte)"
Write-Host ""

Write-Color $yellow "Si la caméra virtuelle n'est pas active :"
Write-Host "1. Dans OBS, en bas à droite, cliquez sur le bouton 'Start Virtual Camera'"
Write-Host "2. L'icône devient verte"
Write-Host "3. WhatsApp/Telegram pourront maintenant la sélectionner"
Write-Host ""

# === ÉTAPE 5: Ouvrir ChapCam sur Live Swap ===
Write-Color $yellow "`n--- ÉTAPE 5: Lancement ChapCam ---"
Write-Color $reset "Ouverture de ChapCam sur la page Live Swap..."

$chapcamRunning = $false
try {
    # Vérifier si ChapCam est déjà en cours d'exécution
    Write-Color $green "✓ Ouverture de ChapCam sur la page Live Swap..."

    # Ouvrir le navigateur à la bonne URL
    Write-Host "🌐 Ouverture du navigateur sur : http://localhost:3000/dashboard/live-swap"
    start "" "http://localhost:3000/dashboard/live-swap"

} catch {
    Write-Color $yellow "⚠ Impossible d'ouvrir ChapCam automatiquement"
    Write-Host "Vous pouvez ouvrir manuellement : http://localhost:3000/dashboard/live-swap"
}

# === RÉSUMÉ FINAL ===
Write-Color $yellow "`n=== RÉSUMÉ DE LA CONFIGURATION ==="
Write-Color $green "✅ Serveur Next.js : " $reset ($nextRunning ? "DÉMARRÉ" : "NON TROUVÉ - Lancez manuellement : cd $APP_DIR && npm run dev")
Write-Color $green "✅ OBS Studio : " $reset ($obsRunning ? "DÉMARRÉ" : "À LANCER - Le script ci-dessus vous guide")
Write-Color $green "✅ Scène OBS 'ChapCam' : " $reset "Vérifiez manuellement dans OBS (voir instructions ci-dessus)"
Write-Color $green "✅ OBS Virtual Camera : " $reset "Assurez-vous que le bouton 'Start Virtual Camera' est vert en bas à droite d'OBS"
Write-Color $green "✅ ChapCam Live Swap : " $reset "Ouvrez http://localhost:3000/dashboard/live-swap dans votre navigateur"
Write-Host ""

Write-Color $yellow "`n--- INSTRUCTIONS POUR WHATSAPP ---"
Write-Color $green "1. Ouvrez WhatsApp Desktop" $reset
Write-Color $yellow "2. Settings → Devices → Camera" $reset
Write-Color $yellow "3. Sélectionnez 'OBS Virtual Camera' (ou 'ChapCam Camera')" $reset
Write-Color $green "4. Démarrer un appel vidéo" $reset
Write-Color $yellow "5. Vous devriez maintenant voir votre visage AI swapé !" $reset

Write-Color $yellow "`n--- INSTRUCTIONS POUR TELEGRAM ---"
Write-Color $green "1. Ouvrez Telegram Desktop" $reset
Write-Color $yellow "2. Settings → Privacy and Security → Video Calls → Camera" $reset
Write-Color $yellow "3. Sélectionnez 'OBS Virtual Camera'" $reset
Write-Color $green "4. Démarrez un appel vocal ou vidéo" $reset
Write-Color $yellow "5. Votre visage sera swapé par l'IA !" $reset

Write-Color $yellow "`n=== FIN DU SCRIPT ==="
Write-Host "Retrouvez vos logs de diagnostic dans : $APP_DIR\chapcam-debug.log"
Write-Host ""