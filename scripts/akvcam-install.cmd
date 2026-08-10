@echo off
set LOG=C:\chapcam2\chapcam-kz\akvcam-install.log
echo === AKVCAM INSTALL %date% %time% === > "%LOG%"

echo [1] Kill AkVCamAssistant.exe >> "%LOG%"
taskkill /f /im AkVCamAssistant.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

echo [2] Kill AkVCamManager.exe >> "%LOG%"
taskkill /f /im AkVCamManager.exe >> "%LOG%" 2>&1
timeout /t 1 /nobreak >nul

echo [3] regsvr32 (64-bit) depuis C:\Program Files\AkVirtualCamera\x64 >> "%LOG%"
cd /d "C:\Program Files\AkVirtualCamera\x64"
regsvr32 /s "AkVirtualCamera.dll" >> "%LOG%" 2>&1
echo     regsvr32 exit code: %ERRORLEVEL% >> "%LOG%"

echo [4] Verif CLSID >> "%LOG%"
reg query "HKLM\SOFTWARE\Classes\CLSID" /s /f "AkVirtualCamera" /d >> "%LOG%" 2>&1

echo [5] Device + format >> "%LOG%"
"C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe" add-device -i ChapCamCamera "ChapCam Camera" >> "%LOG%" 2>&1
"C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe" add-format ChapCamCamera RGB24 1280 720 30 >> "%LOG%" 2>&1
"C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe" update >> "%LOG%" 2>&1

echo [6] Relance assistant >> "%LOG%"
start "" "C:\Program Files\AkVirtualCamera\x64\AkVCamAssistant.exe"
echo [7] FINI >> "%LOG%"
