# Recherche exhaustive des references a AkVirtualCamera.dll dans le registre
Write-Output "=== References AkVirtualCamera.dll / AkVCam dans HKLM ==="
$found = 0
$roots = @(
  'HKLM:\SOFTWARE\Classes\CLSID',
  'HKLM:\SOFTWARE\WOW6432Node\Classes\CLSID',
  'HKLM:\SOFTWARE\Classes',
  'HKLM:\SOFTWARE\Microsoft\Windows Media Foundation',
  'HKLM:\SOFTWARE\Microsoft\Windows Media Foundation\RegisteredTransforms',
  'HKLM:\SOFTWARE\Microsoft\Windows Media Foundation\FrameServer'
)
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      $vals = $props.PSObject.Properties | ForEach-Object { $_.Value }
      foreach ($v in $vals) {
        if ($v -is [string] -and ($v -match 'AkVirtualCamera' -or $v -match 'AkVCam')) {
          Write-Output ("  " + $_.PSPath + "  <= " + $v.Substring(0, [Math]::Min(80, $v.Length)))
          $found++
          break
        }
      }
    } catch {}
  }
}
Write-Output ("Total: " + $found + " references")

Write-Output ""
Write-Output "=== CLSID avec InprocServer32 pointant vers AkVirtualCamera.dll ==="
Get-ChildItem 'HKLM:\SOFTWARE\Classes\CLSID' -ErrorAction SilentlyContinue | ForEach-Object {
  $ip = Join-Path $_.PSPath 'InprocServer32'
  if (Test-Path $ip) {
    $dll = (Get-ItemProperty $ip -ErrorAction SilentlyContinue).'(default)'
    if ($dll -match 'AkVirtualCamera') {
      Write-Output ("  " + $_.PSChildName + " => " + $dll)
    }
  }
}

Write-Output ""
Write-Output "=== KSCATEGORY_VIDEO_CAMERA complet (toutes cameras) ==="
$cat = 'HKLM:\SOFTWARE\Classes\CLSID\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\Instance'
if (Test-Path $cat) {
  Get-ChildItem $cat | ForEach-Object {
    $fname = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).FriendlyName
    Write-Output ("  " + $_.PSChildName + " => " + $fname)
  }
}
