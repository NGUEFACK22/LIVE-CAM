# Test de bout en bout : stream-pattern actif + enumeration WinRT simultanee.
$mgr = 'C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe'

# 1. Lancer le stream-pattern en arriere-plan (il emet un motif de test reel)
$p = Start-Process -FilePath $mgr -ArgumentList 'stream-pattern','ChapCamCamera','640','360','-f','10' -PassThru -WindowStyle Hidden
Write-Output ("stream-pattern lance PID=" + $p.Id)
Start-Sleep -Seconds 3

# 2. Enumeration WinRT pendant l'emission
Write-Output "=== Enumeration WinRT (ce que voit WhatsApp) ==="
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)
  $task = $asTaskGeneric.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.Enumeration.DeviceInformation]]).Invoke($null, @($op))
  $task.Wait(8000) | Out-Null
  $devs = $task.Result
  Write-Output ("Cameras: " + $devs.Count)
  foreach ($d in $devs) { Write-Output ("  - " + $d.Name) }
} catch {
  Write-Output ("WinRT ERR: " + $_.Exception.Message)
}

# 3. ffmpeg dshow en parallele
Write-Output "=== ffmpeg dshow ==="
$ff = Start-Process -FilePath 'ffmpeg' -ArgumentList '-f','dshow','-list_devices','true','-i','dummy' -NoNewWindow -Wait -RedirectStandardError (Join-Path $env:TEMP 'ffdev.log') -PassThru
Get-Content (Join-Path $env:TEMP 'ffdev.log') | Select-String -Pattern 'ChapCam|OBS|Integrated' | ForEach-Object { Write-Output ("  " + $_.Line.Trim()) }

# 4. Arreter le stream
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Write-Output "=== fin ==="
