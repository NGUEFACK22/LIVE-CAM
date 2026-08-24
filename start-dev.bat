@echo off
echo ============================================================
echo ChapCam - Demarrage du dev local (Supabase + Next.js)
echo ============================================================
echo.

echo [1/4] Verification de Docker...
docker version --format "{{.Server.Version}}" >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Docker n'est pas installe ou pas demarre.
    echo Installez Docker Desktop: https://docker.com/products/docker-desktop
    echo Puis redemarrez votre PC et relancez ce script.
    pause
    exit /b 1
)
echo OK - Docker detecte
echo.

echo [2/4] Demarrage de la stack Supabase locale...
docker compose up -d
if errorlevel 1 (
    echo ERREUR: docker compose up a echoue.
    pause
    exit /b 1
)
echo Attente 45 secondes que les services demarrent...
timeout /t 45 /nobreak
echo.

echo [3/4] Verification des services...
docker compose ps
echo.

echo [4/4] Demarrage de Next.js...
echo L'application sera disponible sur http://localhost:3000
echo Appuyez sur Ctrl+C pour arreter.
echo.
npm run dev