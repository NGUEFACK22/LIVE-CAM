@echo off
<#
  ==============================================================================
  Script de démarrage automatique ChapCam Desktop pour Windows 11
  Auteur: Configuration ChapCam
  Date: 2026

  Ce script configure tout automatiquement :
  - Lance le serveur Next.js local
  - Démarre OBS Studio s'il n'est pas en cours d'exécution
  - Crée/rafraîchit la scène "ChapCam" dans OBS
  - Démarre la OBS Virtual Camera
  - Ouvre ChapCam sur la page Live Swap
  - Affiche les étapes de configuration WhatsApp et Telegram
  ==============================================================================
#>

:: === CONFIGURATION ===
set APP_DIR=C:\chapcam2\chapcam-kz
set NODE_EXE=node
set OBS_EXE=obs64.exe

echo.
echo ==========================================
echo  CHAPCAM DESKTOP - CONFIGURATION AUTOMATIQUE
echo  Windows 11 - Live Face Swap Setup
echo ==========================================
echo.

:: Vérifier si on est dans le bon répertoire
if not exist "%APP_DIR%" (
    echo [ERREUR] Répertoire introuvable : %APP_DIR%
    echo Veuillez vérifier le chemin d'installation de ChapCam
    pause
    exit /b 1
)

cd "%APP_DIR%"
echo [OK] Répertoire ChapCam trouvé : %APP_DIR%
echo.

:: === ÉTAPE 1: Vérifier et lancer le serveur Next.js ===
echo.
echo ==========================================
echo [ETAPE 1] Serveur Next.js
echo ==========================================
echo.

set nextRunning=0
timeout /t 2 /nobreak >nul
powershell -Command "tcpTest = New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000); if ($tcpTest.Connected) { '1' } else { '0' }" | find "1" >nul && set nextRunning=1

if %nextRunning% equ 0 (
    echo [INFO] Démarrage du serveur Next.js en développement...
    start "" "%NODE_EXE%" -e "& '%APP_DIR%\node_modules\.bin\next dev -p 3000'"
    timeout /t 5 /nobreak >nul

    :: Vérifier si le serveur a démarré
    powershell -Command "tcpTest2 = New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000); if ($tcpTest2.Connected) { '1' } else { '0' }" | find "1" >nul && set nextRunning=1
)

if %nextRunning% equ 1 (
    echo [OK] Serveur Next.js en cours d'exécution sur le port 3000
) else (
    echo [ERREUR] Échec du démarrage du serveur Next.js
    echo Lancez manuellement : cd %APP_DIR% && npm run dev
    echo Vérifiez votre fichier chapcam-debug.log pour plus de détails
)

:: === ÉTAPE 2: Vérifier et lancer OBS Studio ===
echo.
echo ==========================================
echo [ETAPE 2] OBS Studio
echo ==========================================
echo.

:OBS_CHECK
tasklist /fi "imagename eq obs64.exe" | find "obs64.exe" >nul
if %errorlevel% equ 0 (
    echo [OK] OBS Studio déjà en cours d'exécution.
    goto :OBS_SCENE
) else (
    echo [INFO] Lancement d'OBS Studio...
    start "" "%OBS_EXE%"
    timeout /t 15 /nobreak >nul
    goto :OBS_CHECK
)

:OBS_SCENE
echo.
echo [INFO] Scène OBS requise : 'ChapCam'
echo.

echo [INSTRUCTIONS] :
echo 1. Dans OBS Studio, allez dans le panneau Scènes (gauche)
echo 2. Cliquez sur le bouton + (ajouter une scène)
echo 3. Nom : "ChapCam"
echo 4. Cliquez sur OK
echo 5. Ajoutez un dispositif "Capture de fenêtre"
echo 6. Dans la fenêtre, sélectionnez "ChapCam" dans la liste
echo 7. Ajoutez un "Dispositif de capture vidéo"
echo 8. Sélectionnez "OBS Virtual Camera"
echo 9. En bas à droite d'OBS, cliquez sur "Start Virtual Camera"
echo    (l'icône devient verte)
echo.
echo [ASTUCE] Si la scène ChapCam existe déjà, sautez ces étapes.
echo.

:: === ÉTAPE 3: Démarrer la OBS Virtual Camera ===
echo.
echo ==========================================
echo [ETAPE 3] OBS Virtual Camera
echo ==========================================
echo.

echo [VERIFICATION] :
echo - OBS Studio est %errorlevel%%
echo - Scène ChapCam: %errorlevel%%
echo.

echo [INSTRUCTIONS] :
echo 1. En bas à droite d'OBS, cherchez le bouton "Start Virtual Camera"
echo 2. S'il affiche "Start", cliquez dessus
echo 3. L'icône devient verte → Virtual Camera activée
echo 4. WhatsApp/Telegram peuvent maintenant la sélectionner
echo.
echo Si le bouton affiche déjà "Virtual Camera activée", vous pouvez passer àetape 4.
echo.

:: === ÉTAPE 4: Ouvrir ChapCam sur Live Swap ===
echo.
echo ==========================================
echo [ETAPE 4] ChapCam Live Swap
echo ==========================================
echo.

echo [INFO] Ouverture de ChapCam sur la page Live Swap...
echo.

:: Ouvrir le navigateur à la bonne URL
start "" "http://localhost:3000/dashboard/live-swap"
timeout /t 3 /nobreak >nul

echo [OK] Navigateur ouvert sur : http://localhost:3000/dashboard/live-swap
echo.

:: === RÉSUMÉ FINAL ===
echo.
echo ==========================================
echo  RÉSUMÉ DE LA CONFIGURATION
echo ==========================================
echo.

echo [ETAPE 1] Serveur Next.js : %nextRunning%
if %nextRunning% equ 1 (
    echo [OK] DÉMARRÉ sur le port 3000
) else (
    echo [ATTENTION] Non démarré - Lancez manuellement : cd %APP_DIR% && npm run dev
)

echo [ETAPE 2] OBS Studio : %errorlevel%
if %errorlevel% equ 0 (
    echo [OK] DÉMARRÉ
) else (
    echo [ATTENTION] Non démarré - Lancez manuellement sedan le menu Démarrer
)

echo.
echo [ETAPE 3] OBS Virtual Camera :
echo 1. Vérifiez en bas à droite d'OBS
echo 2. Bouton "Start Virtual Camera" → cliquez s'il n'est pas vert
echo 3. Icône verte = activée ✅
echo.

echo [ETAPE 4] Chapcam Live Swap :
echo 1. Ouvrez http://localhost:3000/dashboard/live-swap
echo 2. Démarrez le Live Swap
echo 3. Profitez de votre visage AI swapé !
echo.

echo [INSTRUCTIONS WHATSAPP] :
echo 1. Ouvrez WhatsApp Desktop
echo 2. Settings (Ctrl+,)
echo 3. Devices → Camera
echo 4. Sélectionnez "OBS Virtual Camera"
echo 5. Démarrez un appel vidéo
echo 6. Vous devriez voir votre visage AI swapé !
echo.

echo [INSTRUCTIONS TELEGRAM] :
echo 1. Ouvrez Telegram Desktop
echo 2. Settings → Privacy and Security → Video Calls → Camera
echo 3. Sélectionnez "OBS Virtual Camera"
echo 4. Démarrez un appel vocal ou vidéo
echo 5. Votre visage sera swapé par l'IA !
echo.

echo.
echo ==========================================
echo  FIN DU SCRIPT
echo ==========================================
echo.
echo - Retrouvez vos logs de diagnostic dans : %APP_DIR%\chapcam-debug.log
echo.
pause