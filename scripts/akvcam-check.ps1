# Etat complet du pilote akvirtualcamera apres l'installation officielle 9.4.1
Write-Output "=== 1. Process AkVCam ==="
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'AkVCam' } | ForEach-Object {
  Write-Output ("  " + $_.Name + " PID=" + $_.Id + " Mem=" + [math]::Round($_.WorkingSet64/1MB) + " Mo")
}

Write-Output ""
Write-Output "=== 2. Cle registre AkVirtualCamera ==="
$k = 'HKLM:\SOFTWARE\AkVirtualCamera'
if (Test-Path $k) {
  Get-ChildItem $k -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ("  " + $_.PSPath) }
} else {
  Write-Output "  cle absente"
}

Write-Output ""
Write-Output "=== 3. Media Foundation MFT (ClsidName) ==="
$mft = 'HKLM:\SOFTWARE\Classes\CLSID'
Get-ChildItem $mft -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $n = (Get-ItemProperty $_.PSPath -ErrorAction Stop).'(default)'
  } catch { $n = '' }
  if ($n -match 'akvirtual|akvcam|virtual camera') {
    Write-Output ("  " + $_.PSChildName + " => " + $n)
  }
}

Write-Output ""
Write-Output "=== 4. Fichiers de config du pilote (APPDATA) ==="
$cfg = Join-Path $env:APPDATA 'AkVirtualCamera'
if (Test-Path $cfg) {
  Get-ChildItem $cfg -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ("  " + $_.FullName) }
} else {
  Write-Output "  pas de config APPDATA"
}

Write-Output ""
Write-Output "=== 5. Installeur : processus en cours ? ==="
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'install' -and $_.MainWindowTitle } | ForEach-Object {
  Write-Output ("  " + $_.Name + " PID=" + $_.Id + " titre='" + $_.MainWindowTitle + "'")
}
