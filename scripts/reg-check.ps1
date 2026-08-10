# Verifier l'enregistrement du filtre DirectShow / MFT AkVirtualCamera
Write-Output "=== 1. CLSID commencant par AkVCam (HKLM Classes\CLSID) ==="
$found = $false
foreach ($root in @('HKLM:\SOFTWARE\Classes\CLSID', 'HKLM:\SOFTWARE\WOW6432Node\Classes\CLSID')) {
  if (Test-Path $root) {
    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $name = (Get-ItemProperty $_.PSPath -ErrorAction Stop).'(default)'
      } catch { $name = '' }
      if ($name -match 'AkVirtualCamera|AkVCam') {
        $found = $true
        Write-Output ("  CLSID: " + $_.PSChildName + " => " + $name)
        # Afficher le InprocServer32
        $ip = Join-Path $_.PSPath 'InprocServer32'
        if (Test-Path $ip) {
          $dll = (Get-ItemProperty $ip -ErrorAction SilentlyContinue).'(default)'
          Write-Output ("    DLL: " + $dll + " (existe: " + (Test-Path $dll) + ")")
        }
      }
    }
  }
}
if (-not $found) { Write-Output "  AUCUN CLSID AkVirtualCamera trouve" }

Write-Output ""
Write-Output "=== 2. Categories DirectShow (KSCATEGORY_VIDEO_CAMERA) ==="
# Les cameras video DirectShow apparaissent sous la category video capture
$cat = 'HKLM:\SOFTWARE\Classes\CLSID\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\Instance'
if (Test-Path $cat) {
  Get-ChildItem $cat -ErrorAction SilentlyContinue | ForEach-Object {
    $fname = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).FriendlyName
    Write-Output ("  " + $_.PSChildName + " => " + $fname)
  }
} else {
  Write-Output "  categorie absent"
}
