@echo off
echo ============================================================
echo ChapCam - Test d'authentification (EXECUTION AUTONOME)
echo ============================================================
echo.
echo Ce script teste directement l'API Supabase cloud.
echo Il va :
echo  1. Verifier que Supabase est accessible
echo  2. Tenter une inscription avec un email de test
echo  3. Tenter une connexion avec le meme email
echo.
echo Les resultats seront affiches ci-dessous.
echo ============================================================
echo.

REM Test de sante Supabase
echo [1] Test de sante Supabase...
curl -s -o health.json https://ojmzqokffbptmcktnwdy.supabase.co/auth/v1/health
if exist health.json (
    echo OK - Supabase repond:
    type health.json
    echo.
    del health.json
) else (
    echo ERREUR: Impossible de joindre Supabase.
    echo Verifiez votre connexion Internet.
    pause
    exit /b 1
)

REM Test d'inscription avec Node.js
echo [2] Test d'inscription avec Node.js...
node test-auth.js

echo.
echo ============================================================
echo Test termine.
echo ============================================================
pause