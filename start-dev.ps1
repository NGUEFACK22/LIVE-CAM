# ============================================================
# ChapCam — Démarrage complet du dev local (Supabase + Next.js)
# ============================================================
# Ce script :
# 1. Vérifie que Docker est installé et démarré
# 2. Démarre la stack Supabase locale (docker compose up -d)
# 3. Attend que tous les services soient healthy
# 4. Installe les dépendances npm si besoin
# 5. Lance Next.js en mode dev
# ============================================================

$ErrorActionPreference = "Stop"
$PROJECT_ROOT = $PSScriptRoot

Write-Host "🔍 Vérification de Docker..." -ForegroundColor Cyan
try {
    $dockerVersion = docker version --format "{{.Server.Version}}" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker daemon non accessible"
    }
    Write-Host "✅ Docker $dockerVersion détecté" -ForegroundColor Green
} catch {
    Write-Host "❌ ERREUR : Docker n'est pas installé ou pas démarré." -ForegroundColor Red
    Write-Host "   Installez Docker Desktop : https://docker.com/products/docker-desktop" -ForegroundColor Yellow
    Write-Host "   Puis démarrez l'application Docker Desktop avant de relancer ce script." -ForegroundColor Yellow
    exit 1
}

Write-Host "🚀 Démarrage de la stack Supabase locale..." -ForegroundColor Cyan
Set-Location $PROJECT_ROOT
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ERREUR : docker compose up a échoué." -ForegroundColor Red
    exit 1
}

Write-Host "⏳ Attente du démarrage des services (30s)..." -ForegroundColor Cyan
Start-Sleep -Seconds 30

# Vérification de santé
$maxAttempts = 10
$attempt = 0
$allHealthy = $false

while ($attempt -lt $maxAttempts -and -not $allHealthy) {
    $attempt++
    Write-Host "   Tentative $attempt/$maxAttempts..." -ForegroundColor Gray
    
    $composeOutput = docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}" 2>&1
    Write-Host $composeOutput
    
    # Vérifie si tous les services sont healthy ou au moins running
    $unhealthy = docker compose ps --format "{{.Status}}" | Where-Object { $_ -notmatch "healthy" -and $_ -notmatch "running" -and $_ -notmatch "STATUS" }
    
    if (-not $unhealthy) {
        $allHealthy = $true
        Write-Host "✅ Tous les services sont démarrés !" -ForegroundColor Green
    } else {
        Write-Host "   Certains services ne sont pas encore prêts..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
}

if (-not $allHealthy) {
    Write-Host "⚠️  Tous les services ne sont pas healthy après $maxAttempts tentatives." -ForegroundColor Yellow
    Write-Host "   Vérifiez les logs avec : docker compose logs" -ForegroundColor Gray
    # On continue quand même, peut-être que certains services sont optionnels
}

Write-Host "📦 Vérification des dépendances npm..." -ForegroundColor Cyan
if (-not (Test-Path "$PROJECT_ROOT\node_modules")) {
    Write-Host "   Installation des dépendances (npm install)..." -ForegroundColor Gray
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ ERREUR : npm install a échoué." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✅ node_modules déjà présent" -ForegroundColor Green
}

Write-Host "🌐 Démarrage de Next.js..." -ForegroundColor Cyan
Write-Host "   L'application sera disponible sur http://localhost:3000" -ForegroundColor Gray
Write-Host "   Appuyez sur Ctrl+C pour arrêter." -ForegroundColor Gray

npm run dev