<#
.SYNOPSIS
    ChapCam - Script de démarrage local Windows
.DESCRIPTION
    Démarre Supabase local (Docker) + Next.js dev server
    Usage: .\start-local.ps1
.NOTES
    Exécuter dans PowerShell (pas besoin d'admin si Docker Desktop installé)
#>

param(
    [switch]$SkipDocker,
    [switch]$SkipInstall,
    [switch]$NoSupabase
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

function Write-Status($msg, $color = "Yellow") {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor $color
}

function Check-Command($cmd, $name) {
    try {
        & $cmd --version 2>$null | Out-Null
        return $true
    } catch {
        return $false
    }
}

# ============================================================
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  ChapCam - Démarrage Local Complet" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# 1. Vérifier Docker
if (-not $SkipDocker -and -not $NoSupabase) {
    Write-Status "Vérification de Docker..."
    if (-not (Check-Command "docker" "Docker")) {
        Write-Status "❌ Docker non trouvé. Installez Docker Desktop: https://docker.com/products/docker-desktop" "Red"
        exit 1
    }
    Write-Status "✅ Docker OK" "Green"

    # Vérifier que le service Docker tourne
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Status "❌ Docker Desktop n'est pas en cours d'exécution. Lancez Docker Desktop et réessayez." "Red"
        Write-Status "   $dockerInfo" "Gray"
        exit 1
    }
    Write-Status "✅ Docker Desktop en cours d'exécution" "Green"

    Write-Status "Vérification de docker compose..."
    if (-not (Check-Command "docker compose" "Docker Compose")) {
        Write-Status "❌ 'docker compose' non disponible (Docker Desktop récent requis)" "Red"
        exit 1
    }
    Write-Status "✅ docker compose OK" "Green"
}

# 2. Vérifier .env.local
Write-Status "Vérification de .env.local..."
$envFile = Join-Path $projectRoot ".env.local"
$exampleFile = Join-Path $projectRoot ".env.example"

if (-not (Test-Path $envFile)) {
    Write-Status "⚠️  .env.local manquant - création depuis .env.example" "Yellow"
    Copy-Item $exampleFile $envFile -Force
    Write-Status "✅ .env.local créé - EDITEZ-LE avec vos clés Supabase !" "Green"
    Write-Status "   Clés requises: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY" "Gray"
} else {
    Write-Status "✅ .env.local existe" "Green"
    # Vérifier que les champs obligatoires ne sont pas vides
    $envContent = Get-Content $envFile | Out-String
    if ($envContent -match 'NEXT_PUBLIC_SUPABASE_URL=$' -or (-not ($envContent -match 'NEXT_PUBLIC_SUPABASE_URL='))) {
        Write-Status "⚠️  NEXT_PUBLIC_SUPABASE_URL semble vide dans .env.local" "Yellow"
    }
}

# 3. Démarrer Supabase Local
if (-not $NoSupabase) {
    Write-Status "Démarrage de Supabase Local (Docker)..."
    Set-Location $projectRoot

    Write-Status "   Arrêt containers existants..." "Gray"
    docker compose down --remove-orphans 2>$null

    Write-Status "   Lancement docker compose up -d..." "Gray"
    docker compose up -d

    # Attendre les services
    Write-Status "   Attente des services (30-60s)... " "Yellow"
    $services = @("db", "kong", "auth", "rest", "realtime", "storage", "studio")
    $maxWait = 120

    foreach ($svc in $services) {
        $containerName = "chapcam-$svc"
        Write-Status "   ⏳ $svc..." "Gray"
        $start = Get-Date

        while ($true) {
            $status = docker inspect --format='{{.State.Health.Status}}' $containerName 2>$null
            if ($status -eq "healthy") {
                Write-Status "   ✅ $svc prêt" "Green"
                break
            }
            if ((Get-Date) - $start).TotalSeconds -gt $maxWait) {
                Write-Status "   ⚠️  $svc timeout - vérifiez: docker logs $containerName" "Yellow"
                break
            }
            Start-Sleep -Seconds 3
        }
    }

    Write-Host "`n📊 Supabase Local URLs :" -ForegroundColor Cyan
    Write-Host "   Studio (Dashboard):     http://localhost:54329" -ForegroundColor Gray
    Write-Host "   API Gateway (Kong):     http://localhost:54321" -ForegroundColor Gray
    Write-Host "   REST API (PostgREST):   http://localhost:54325" -ForegroundColor Gray
    Write-Host "   Auth (GoTrue):          http://localhost:54324" -ForegroundColor Gray
    Write-Host "   Realtime:               http://localhost:54326" -ForegroundColor Gray
    Write-Host "   Storage:                http://localhost:54327" -ForegroundColor Gray
    Write-Host "   Mailhog (Emails):       http://localhost:8025" -ForegroundColor Gray
}

# 4. Installer dépendances npm
if (-not $SkipInstall) {
    Write-Status "Installation dépendances npm..."
    Set-Location $projectRoot
    if (-not (Test-Path "node_modules")) {
        Write-Status "   Premier install (peut prendre quelques minutes)..." "Yellow"
        # --legacy-peer-deps: @fal-ai/serverless-proxy exige express@^4
        # alors que le projet utilise express@^5.
        # --ignore-scripts: le postinstall electron > telecharge de gros binaires
        if (Test-Path "pnpm-lock.yaml") {
            Write-Status "   pnpm-lock.yaml détecté - utilisation de pnpm recommandée" "Yellow"
            if (Check-Command "pnpm" "pnpm") {
                pnpm install --ignore-scripts
            } else {
                npm install --legacy-peer-deps --ignore-scripts
            }
        } else {
            npm install --legacy-peer-deps --ignore-scripts
        }
    } else {
        Write-Status "   node_modules existe - utilsez -SkipInstall dans le script ou -SkipInstall:$false pour forcer" "Gray"
    }
    Write-Status "✅ Dépendances OK" "Green"
}

# 5. Lancer Next.js
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  🚀 Lancement Next.js Dev Server" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# Détecter un port libre (le port 3000 est parfois occupé par d'autres
# services, ex: le bridge WhatsApp de Hermes). Le script scripts/dev.mjs
# choisi automatiquement le premier port libre à partir de 3000.
$port = 3000
try {
    while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        $port++
    }
} catch {
    # Si la commande échoue (droits admin requis sur certaines versions), on essaie avec un test simple
    Write-Status "   Détection de port par scripts/dev.mjs..." "Gray"
    $port = 3000
}

Write-Host "   App accessible sur: http://localhost:$port" -ForegroundColor Green
Write-Host "   Dashboard:          http://localhost:$port/dashboard" -ForegroundColor Gray
Write-Host "   Live Swap:          http://localhost:$port/dashboard/live-swap" -ForegroundColor Gray
Write-Host "`n   Ctrl+C pour arrêter`n" -ForegroundColor Gray

Set-Location $projectRoot
npm run dev