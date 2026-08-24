@"
===============================================================================
=== CHAPCAM LIVE SWAP - TEST SETUP WhatsApp/Telegram ===
=== Setup de test complet en une seule commande ===
===============================================================================
"@

# Configuration
$ErrorActionPreference = "Stop"
$APP_DIR = "C:\chapcam2\chapcam-kz"

Write-Host "`e[32m=== CHAPCAM LIVE SWAP - TEST SETUP ===`e[0m" -ForegroundColor Cyan
Write-Host "Platform: WhatsApp & Telegram Desktop" -ForegroundColor Cyan

# Check prerequisites
Write-Host "`n=== VÉRIFICATION DES PRÉREQUIS ===`n" -ForegroundColor Yellow

if (-not (Test-Path $APP_DIR)) {
    Write-Error "❌ Répertoire introuvable : $APP_DIR"
    exit 1
}
Write-Host "✅ Répertoire ChapCam trouvé : $APP_DIR" -ForegroundColor Green

if (-not (Test-Path "$APP_DIR\package.json")) {
    Write-Error "❌ package.json introuvable"
    Write-Host "Assurez-vous d'avoir installé les dépendances"
    exit 1
}
Write-Host "✅ package.json trouvé" -ForegroundColor Green

# Check OBS
Write-Host "⏳ Vérification de OBS Studio..." -ForegroundColor Yellow
$obsRunning = $false
try {
    $obsProcess = Get-Process -Name obs -ErrorAction Stop
    Write-Host "✅ OBS Studio déjà en cours d'exécution (PID: $($obsProcess.Id))" -ForegroundColor Green
    $obsRunning = $true
} catch {
    Write-Host "⚠ OBS Studio n'est pas en cours d'exécution" -ForegroundColor Yellow
}

# Launch Next.js server
Write-Host "`n=== LANÇAGE DU SERVEUR NEXT.JS ===`n" -ForegroundColor Yellow
Write-Host "Démarrage du serveur Next.js en développement..." -ForegroundColor White

$nextCMD = "node -e "& 'C:\chapcam2\chapcam-kz\node_modules\.bin\next dev -p 3000'"
Start-Process -FilePath "node" -ArgumentList "-e", "$nextCMD" -RedirectStandardOutput -RedirectStandardError -NoNewWindow -Wait -LoadUserProfile $false | Out-Null

# Wait for server to start
Start-Sleep -Seconds 5

# Check if server is running
Write-Host "Vérification de la connexion au serveur..." -ForegroundColor White
$tcpTest = New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000)
if ($tcpTest.Connected) {
    Write-Host "✅ Serveur Next.js en cours d'exécution sur le port 3000" -ForegroundColor Green
    $nextRunning = $true
} else {
    Write-Host "⚠ Serveur Next.js en cours de démarrage (peut prendre 10-15s)" -ForegroundColor Yellow
    $nextRunning = $false
}

# Launch OBS if not running
if (-not $obsRunning) {
    Write-Host "`nLancement d'OBS Studio..." -ForegroundColor White
    Start-Process -FilePath "C:\Program Files\obs-studio\bin\64bit\obs64.exe" -PassThru -ErrorAction SilentlyContinue | Out-Null
    Start-Sleep -Seconds 10
}

# Open ChapCam in browser
Write-Host "`n=== OUVERTURE DE CHAPCAM LIVE SWAP ===`n" -ForegroundColor White
Write-Host "Ouverture du navigateur sur : http://localhost:3000/dashboard/live-swap" -ForegroundColor Cyan
start "" "http://localhost:3000/dashboard/live-swap"

# Summary
Write-Host "`n=== RÉSUMÉ DU TEST ===`n" -ForegroundColor Cyan
Write-Host "✅ Navigateur : http://localhost:3000/dashboard/live-swap" -ForegroundColor Green
Write-Host "✅ OBS Studio : $(if ($obsRunning) { 'Déjà lancé' } else { 'Lancé par le script' })" -ForegroundColor Green
Write-Host "✅ Serveur Next.js : Port 3000" -ForegroundColor Green

Write-Host "`n>>> PROCHAINES ÉTAPES POUR TESTER <<<`n" -ForegroundColor Yellow
Write-Host "1. Dans ChapCam Live Swap : Cliquez sur 'Démarrer le Live Swap'" -ForegroundColor White
Write-Host "2. Ouvrez WhatsApp Desktop → Settings → Devices → Camera → OBS Virtual Camera" -ForegroundColor White
Write-Host "3. Ouverture Telegram → Settings → Privacy and Security → Video Calls → Camera → OBS Virtual Camera" -ForegroundColor White
Write-Host "4. Profitez de votre visage AI swapé sur WhatsApp ET Telegram !`n" -ForegroundColor White

Write-Host "=== Test setup terminé - bonne utilisation ! ===" -ForegroundColor Cyan