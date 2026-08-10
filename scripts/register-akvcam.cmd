@echo off
cd /d "C:\Program Files\AkVirtualCamera\x64"
echo [AKVCAM] regsvr32 AkVirtualCamera.dll depuis %CD% >> "C:\chapcam2\chapcam-kz\akvcam-reg.log"
regsvr32 /s "AkVirtualCamera.dll" >> "C:\chapcam2\chapcam-kz\akvcam-reg.log" 2>&1
echo [AKVCAM] regsvr32 exit code: %ERRORLEVEL% >> "C:\chapcam2\chapcam-kz\akvcam-reg.log"
echo [AKVCAM] Termine. >> "C:\chapcam2\chapcam-kz\akvcam-reg.log"
