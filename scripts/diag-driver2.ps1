Write-Output "=== Contenu dossier pilote installe ==="
Get-ChildItem 'C:\Program Files\AkVirtualCamera\x64' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("  " + $_.Name + " (" + $_.Length + " octets)")
}
Write-Output ""
Write-Output "=== Version DLL ==="
$dll = 'C:\Program Files\AkVirtualCamera\x64\AkVirtualCamera.dll'
if (Test-Path $dll) {
  $vi = (Get-Item $dll).VersionInfo
  Write-Output ("  FileVersion: " + $vi.FileVersion)
  Write-Output ("  ProductVersion: " + $vi.ProductVersion)
  Write-Output ("  Company: " + $vi.CompanyName)
}
Write-Output ""
Write-Output "=== Dependances (dumpbin absent ? on tente via load) ==="
try {
  $asm = [System.Reflection.AssemblyName]::GetAssemblyName($dll)
  Write-Output "  chargeable (CLR): " + $asm.FullName
} catch {
  Write-Output "  Pas une assembly CLR (normal pour DLL native). Err: $($_.Exception.Message)"
}
Write-Output ""
Write-Output "=== VC++ runtime present ? ==="
foreach ($rt in @('C:\Windows\System32\vcruntime140.dll', 'C:\Windows\System32\msvcp140.dll', 'C:\Windows\System32\vcruntime140_1.dll')) {
  Write-Output ("  " + $rt + " => " + (Test-Path $rt))
}
Write-Output ""
Write-Output "=== Test LoadLibrary direct (non-admin) ==="
try {
  $sig = @'
using System;
using System.Runtime.InteropServices;
public static class NativeLoad {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibrary(string lpFileName);
}
'@
  Add-Type -TypeDefinition $sig -ErrorAction Stop
  $h = [NativeLoad]::LoadLibrary($dll)
  if ($h -eq [IntPtr]::Zero) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output ("  LoadLibrary ECHEC, erreur Win32: " + $err)
  } else {
    Write-Output "  LoadLibrary OK (la DLL se charge, l'enregistrement devrait marcher en admin)"
    [NativeLoad]::FreeLibrary($h) | Out-Null
  }
} catch {
  Write-Output "  LoadLibrary test erreur: $($_.Exception.Message)"
}
