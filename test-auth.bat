@echo off
echo ============================================================
echo ChapCam - Test d'authentification Supabase
echo ============================================================
echo.
echo Ce test va :
echo  1. Verifier que Supabase cloud est accessible
echo  2. Tenter une inscription avec un email de test
echo  3. Tenter une connexion avec le meme email
echo.
echo Les resultats seront ecrits dans test-auth-result.txt
echo ============================================================
echo.

node test-auth.js > test-auth-result.txt 2>&1

if errorlevel 1 (
    echo ERREUR: Le test a echoue. Voir test-auth-result.txt
) else (
    echo Test termine avec succes. Voir test-auth-result.txt
)

echo.
type test-auth-result.txt
echo.
pause