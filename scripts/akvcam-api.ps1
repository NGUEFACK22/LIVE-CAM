$mgr = 'C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe'
Write-Output "=== system-api ==="
& $mgr system-api 2>&1 | Select-Object -First 5
Write-Output ""
Write-Output "=== system-api --parseable ==="
& $mgr system-api --parseable 2>&1 | Select-Object -First 5
Write-Output ""
Write-Output "=== data-modes ==="
& $mgr data-modes 2>&1 | Select-Object -First 8
Write-Output ""
Write-Output "=== default-data-mode ==="
& $mgr default-data-mode 2>&1 | Select-Object -First 5
Write-Output ""
Write-Output "=== AkVCamTest --help ==="
$test = 'C:\Program Files\AkVirtualCamera\x64\AkVCamTest.exe'
if (Test-Path $test) {
  & $test --help 2>&1 | Select-Object -First 20
} else {
  Write-Output "  absent"
}
