@echo off
set LOG=C:\chapcam2\chapcam-kz\akvcam-state.log
echo === AKVCAM STATE %date% %time% === > "%LOG%"

echo [0] Kill tous les process AkVCam >> "%LOG%"
taskkill /f /im AkVCamAssistant.exe >> "%LOG%" 2>&1
taskkill /f /im AkVCamManager.exe >> "%LOG%" 2>&1
taskkill /f /im AkVCamTest.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

set MGR=C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe

echo [1] Version >> "%LOG%"
"%MGR%" --version >> "%LOG%" 2>&1

echo [2] system-api >> "%LOG%"
"%MGR%" system-api >> "%LOG%" 2>&1

echo [3] devices >> "%LOG%"
"%MGR%" devices >> "%LOG%" 2>&1

echo [4] supported-formats >> "%LOG%"
"%MGR%" supported-formats >> "%LOG%" 2>&1

echo [5] Relance assistant >> "%LOG%"
start "" "C:\Program Files\AkVirtualCamera\x64\AkVCamAssistant.exe"
timeout /t 2 /nobreak >nul
tasklist /fi "IMAGENAME eq AkVCamAssistant.exe" >> "%LOG%" 2>&1

echo [6] FINI >> "%LOG%"
