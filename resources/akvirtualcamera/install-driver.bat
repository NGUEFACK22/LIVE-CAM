@echo off
REM ============================================================
REM Installation du pilote camera virtuelle "ChapCam Camera"
REM akvirtualcamera v9.x : API systeme Media Foundation (system-api).
REM
REM Usage : install-driver.bat "<dossier_du_pilote>"
REM Appele par le hook NSIS customInstall (en administrateur).
REM
REM Le pilote est copie dans C:\Program Files\AkVirtualCamera (emplacement
REM attendu par virtual-camera.js en fallback), puis :
REM   1. l'assistant (AkVCamAssistant.exe) est lance pour armer la camera,
REM   2. le peripherique "ChapCam Camera" est cree/expose,
REM   3. le format RGB24 1280x720@30 est configure.
REM ============================================================
setlocal
set SRC=%~1
if "%SRC%"=="" set SRC=%~dp0
set DST=%ProgramFiles%\AkVirtualCamera
set BIN=%DST%\x64

echo [ChapCam] Dossier source : %SRC%
echo [ChapCam] Dossier cible : %DST%
echo [ChapCam] Architecture : %PROCESSOR_ARCHITECTURE%

REM 0) Arreter l'assistant s'il tourne (liberer les fichiers avant copie).
taskkill /f /im AkVCamAssistant.exe >nul 2>&1

REM 1) Copier les binaires du pilote a l'emplacement systeme.
if not exist "%DST%" mkdir "%DST%"
if exist "%SRC%\x64" (
  if exist "%DST%\x64" rmdir /s /q "%DST%\x64"
  robocopy "%SRC%\x64" "%DST%\x64" /e >nul
  echo [ChapCam] x64 copie vers %DST%\x64
)
if exist "%SRC%\x86" (
  if exist "%DST%\x86" rmdir /s /q "%DST%\x86"
  robocopy "%SRC%\x86" "%DST%\x86" /e >nul
  echo [ChapCam] x86 copie vers %DST%\x86
)

REM 2) Enregistrer le module camera (auto-registration COM + MF).
if exist "%BIN%\AkVirtualCamera.dll" (
  regsvr32 /s "%BIN%\AkVirtualCamera.dll"
  echo [ChapCam] Module AkVirtualCamera.dll enregistre
)

REM 3) Lancer l'assistant (necessaire pour rendre la camera visible).
if exist "%BIN%\AkVCamAssistant.exe" (
  start "" "%BIN%\AkVCamAssistant.exe" >nul 2>&1
  echo [ChapCam] AkVCamAssistant.exe lance depuis %BIN%
) else (
  echo [ChapCam] ATTENTION : AkVCamAssistant.exe introuvable dans %BIN%
)

REM 4) Creer le peripherique visible "ChapCam Camera" (1280x720@30 RGB24).
if exist "%BIN%\AkVCamManager.exe" (
  "%BIN%\AkVCamManager.exe" add-device -i ChapCamCamera "ChapCam Camera" >nul 2>&1
  "%BIN%\AkVCamManager.exe" add-format ChapCamCamera RGB24 1280 720 30 >nul 2>&1
  "%BIN%\AkVCamManager.exe" update >nul 2>&1
  echo [ChapCam] Peripherique "ChapCam Camera" cree
)

echo [ChapCam] Installation du pilote terminee.
endlocal
exit /b 0