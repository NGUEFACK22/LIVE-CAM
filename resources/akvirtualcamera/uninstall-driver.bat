@echo off
REM ============================================================
REM Desinstallation du pilote camera virtuelle "ChapCam Camera"
REM akvirtualcamera v9.x. Appele par le hook NSIS customUnInstall.
REM ============================================================
setlocal
set DST=%ProgramFiles%\AkVirtualCamera
set BIN=%DST%\x64

echo [ChapCam] Suppression du peripherique "ChapCam Camera"...

REM 0) Arreter l'assistant si il tourne.
taskkill /f /im AkVCamAssistant.exe >nul 2>&1

REM 1) Supprimer le peripherique.
if exist "%BIN%\AkVCamManager.exe" (
  "%BIN%\AkVCamManager.exe" remove-device ChapCamCamera >nul 2>&1
  "%BIN%\AkVCamManager.exe" update >nul 2>&1
)

REM 2) Desenregistrer le module camera.
if exist "%BIN%\AkVirtualCamera.dll" (
  regsvr32 /s /u "%BIN%\AkVirtualCamera.dll"
)

REM 3) Supprimer les binaires du pilote.
if exist "%DST%" (
  rmdir /s /q "%DST%"
  echo [ChapCam] Binaires du pilote supprimes (%DST%)
)

echo [ChapCam] Pilote ChapCam Camera supprime.
endlocal
exit /b 0