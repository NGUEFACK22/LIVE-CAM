@echo off
echo ============================================================
echo ChapCam - Diagnostic Authentification
echo ============================================================
echo.

echo [1] Test de connectivite au Supabase Cloud...
echo URL: https://ojmzqokffbptmcktnwdy.supabase.co/auth/v1/health
echo.

curl -s -o nul -w "HTTP Status: %%{http_code}\n" https://ojmzqokffbptmcktnwdy.supabase.co/auth/v1/health
if errorlevel 1 (
    echo ERREUR: Impossible de joindre le serveur Supabase.
    echo Verifiez votre connexion Internet et votre pare-feu.
    pause
    exit /b 1
)

echo.
echo [2] Verification des variables d'environnement Electron...
echo Fichier .env.electron:
if exist .env.electron (
    findstr /C:"NEXT_PUBLIC_SUPABASE_URL" .env.electron
    findstr /C:"NEXT_PUBLIC_SUPABASE_ANON_KEY" .env.electron
) else (
    echo Fichier .env.electron introuvable!
)

echo.
echo [3] Test de l'API d'inscription...
echo Envoi d'une requete POST a /auth/v1/signup...
echo (Ceci est un test sec - aucun compte ne sera cree)
echo.

REM Test CORS
curl -v -X OPTIONS https://ojmzqokffbptmcktnwdy.supabase.co/auth/v1/signup ^
  -H "Origin: http://localhost:3000" ^
  -H "Access-Control-Request-Method: POST" ^
  -H "Access-Control-Request-Headers: content-type, x-supabase-auth-token" ^
  -o nul 2>&1 | findstr /C:"< HTTP" /C:"< access-control"

echo.
echo ============================================================
echo Diagnostic termine.
echo Si le test OPTIONS echoue ou renvoie des erreurs CORS,
echo le probleme vient probablement du patch CORS dans main.js.
echo ============================================================
pause