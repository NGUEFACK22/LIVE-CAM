@echo off
set LOG=C:\chapcam2\chapcam-kz\akvcam-official.log
echo === AKVCAM OFFICIAL INSTALL %date% %time% === > "%LOG%"

set MGR=C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe

echo [0] Aide du manager >> "%LOG%"
"%MGR%" --help >> "%LOG%" 2>&1

echo [1] Kill assistant >> "%LOG%"
taskkill /f /im AkVCamAssistant.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

echo [2] install (enregistrement officiel) >> "%LOG%"
"%MGR%" install >> "%LOG%" 2>&1
echo     install exit code: %ERRORLEVEL% >> "%LOG%"

echo [3] Verif CLSID >> "%LOG%"
reg query "HKLM\SOFTWARE\Classes\CLSID" /s /f "AkVirtualCamera" /d >> "%LOG%" 2>&1

echo [4] Relance assistant >> "%LOG%"
start "" "C:\Program Files\AkVirtualCamera\x64\AkVCamAssistant.exe"

echo [5] FINI >> "%LOG%"
