@echo off
title === TEST SETUP CHAPCAM LIVE SWAP WhatsApp/Telegram ===
cls
echo.
echo  === CHAPCAM LIVE SWAP - TEST SETUP ===
echo  Platform: WhatsApp & Telegram Desktop
echo.
echo  This setup will:
echo  1. Start the Next.js server (port 3000)
echo  2. Launch OBS Studio
echo  3. Open ChapCam Live Swap in your browser
echo  4. Show you WhatsApp/Telegram configuration steps
echo.
echo.
echo  === PREREQUISITES CHECK ===
echo.

:: Check 1: Directory exists
if not exist "C:\chapcam2\chapcam-kz" (
    echo [ERREUR] Répertoire introuvable : C:\chapcam2\chapcam-kz
    echo Veuillez vérifier votre installation de ChapCam
    pause
    exit /b 1
)
echo [OK] Répertoire ChapCam trouvé

:: Check 2: Next.js dependencies
if not exist "C:\chapcam2\chapcam-kz\package.json" (
    echo [ERREUR] package.json introuvable
    echo Assurez-vous d'avoir installé les dépendances
    pause
    exit /b 1
)
echo [OK] package.json trouvé

:: Check 3: OBS Studio
tasklist /fi "imagename eq obs64.exe" | find "obs64.exe" >nul
if %errorlevel% equ 0 (
    echo [OK] OBS Studio déjà en cours d'exécution
    set OBS_RUNNING=1
) else (
    echo [INFO] OBS Studio n'est pas en cours d'exécution
    echo Il sera lancé dans l'étape suivante
    set OBS_RUNNING=0
)

echo.
echo  === LANCEMENT DU SERVEUR NEXT.JS ===
echo.

:: Lancer Next.js en arrière-plan
cd C:\chapcam2\chapcam-kz
echo [INFO] Démarrage du serveur Next.js en développement...
start "" "node" -e "& 'C:\chapcam2\chapcam-kz\node_modules\.bin\next dev -p 3000'"
timeout /t 5 /nobreak >nul

:: Vérifier si le serveur a démarré
powershell -Command "tcpTest = New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000); if ($tcpTest.Connected) { '1' } else { '0' }" | find "1" >nul && set NEXT_RUNNING=1 || set NEXT_RUNNING=0

if %NEXT_RUNNING% equ 1 (
    echo [OK] Serveur Next.js démarré sur le port 3000
) else (
    echo [ATTENTION] Serveur Next.js non détecté - cela peut prendre 10-15s
)

echo.
echo  === ÉTAPE OBS ET CHAPCAM ===
echo.

:: Lancer OBS s'il n'est pas déjà en cours d'exécution
if %OBS_RUNNING% neq 1 (
    echo [INFO] Lancement d'OBS Studio...
    start "" "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
    timeout /t 15 /nobreak >nul
)

:: Ouvrir ChapCam Live Swap dans le navigateur
echo [INFO] Ouverture de ChapCam Live Swap...
start "" "http://localhost:3000/dashboard/live-swap"
timeout /t 3 /nobreak >nul

echo [OK] Navigateur ouvert sur http://localhost:3000/dashboard/live-swap

echo.
echo  === INSTRUCTIONS POST-SETUP ===
echo.

echo  >>>>> CONFIGURATION WHATSAPP <<<<<
echo  1. Ouvrez WhatsApp Desktop (version .exe, pas Microsoft Store)
echo  2. Appuyez sur Ctrl + , (Settings) ou cliquez sur le menu trois points → Settings
echo  3. Allez dans Appareils → Caméra
echo  4. Sélectionnez "OBS Virtual Camera" dans la liste déroulante
echo  5. Démarrez un appel vidéo
echo  6. Vous devriez voir votre visage AI swapé ! ✅
echo.

echo  >>>>> CONFIGURATION TELEGRAM <<<<<
echo  1. Ouvrez Telegram Desktop
echo  2. Settings (menu hamburger en haut à gauche) → Privacy and Security
echo  3. Cliquez sur Video Calls → Camera
echo  4. Sélectionnez "OBS Virtual Camera"
echo  5. Démarrez un appel vocal ou vidéo
echo  6. Votre visage AI swapé apparaît ✅
echo.

echo  >>>>> ASTUCES IMPORTANTES <<<<<
echo  - Gardez la fenêtre ChapCam visible (non minimisée) pendant les appels
echo  - Si l'écran apparaît noir : vérifiez que la scène "ChapCam" est sélectionnée dans OBS
echo  - Si le bouton "Start Virtual Camera" n'est pas vert dans OBS, cliquez dessus
echo  - Redémrez WhatsApp/Telegram si la caméra n'apparaît pas
echo.

echo.
echo  === TEST SETUP TERMINÉ ===
echo.
echo  1. Navigateur ouvert : http://localhost:3000/dashboard/live-swap
echo  2. OBS Studio devrait être en cours d'exécution
echo  3. Suivez les instructions WhatsApp/Telegram ci-dessus
echo.
echo  Appuyez sur n'importe quelle touche pour fermer...
pause >nul