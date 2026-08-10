# Compiler camtest.cs proprement via PowerShell (evite la conversion de chemins MSYS)
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$meta = 'C:\Windows\System32\WinMetadata'
$out = 'C:\chapcam2\chapcam-kz\camtest.exe'
$src = 'C:\chapcam2\chapcam-kz\scripts\camtest.cs'

$args = @(
  '/nologo',
  '/target:exe',
  "/out:$out",
  '/reference:System.Runtime.WindowsRuntime.dll',
  "/reference:$meta\Windows.Foundation.winmd",
  "/reference:$meta\Windows.Devices.winmd",
  $src
)
$p = Start-Process -FilePath $csc -ArgumentList $args -Wait -NoNewWindow -PassThru -RedirectStandardOutput 'C:\chapcam2\chapcam-kz\csc-out.log' -RedirectStandardError 'C:\chapcam2\chapcam-kz\csc-err.log'
Write-Output ("Exit: " + $p.ExitCode)
if (Test-Path $out) {
  Write-Output ("Compile OK: " + (Get-Item $out).Length + " octets")
} else {
  Write-Output "ECHEC:"
  Get-Content 'C:\chapcam2\chapcam-kz\csc-err.log' -ErrorAction SilentlyContinue | Select-Object -First 6
  Get-Content 'C:\chapcam2\chapcam-kz\csc-out.log' -ErrorAction SilentlyContinue | Select-Object -First 6
}
