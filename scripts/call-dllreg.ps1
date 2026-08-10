# Appel direct de DllRegisterServer pour obtenir le HRESULT exact
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class NativeDll {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibrary(string lpFileName);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr hModule);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate int DllRegisterServerDelegate();
}
'@
Add-Type -TypeDefinition $sig -ErrorAction Stop

$dll = 'C:\Program Files\AkVirtualCamera\x64\AkVirtualCamera.dll'
Write-Output ("DLL: " + $dll)
$h = [NativeDll]::LoadLibrary($dll)
if ($h -eq [IntPtr]::Zero) {
  Write-Output ("LoadLibrary ECHEC, Win32 err: " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 1
}
Write-Output "LoadLibrary OK"
$addr = [NativeDll]::GetProcAddress($h, 'DllRegisterServer')
if ($addr -eq [IntPtr]::Zero) {
  Write-Output "DllRegisterServer introuvable (pas un serveur COM enregistrable)"
  [NativeDll]::FreeLibrary($h) | Out-Null
  exit 1
}
$del = [Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($addr, [NativeDll+DllRegisterServerDelegate])
$hr = $del.Invoke()
Write-Output ("DllRegisterServer HRESULT: 0x{0:X8}" -f ($hr -band 0xFFFFFFFF))
# Decoder le HRESULT
if ($hr -eq 0) { Write-Output "SUCCES !" }
elseif (($hr -band 0xFFFF0000) -eq 0x80070000) {
  Write-Output ("Win32 error code: " + ($hr -band 0xFFFF) + " (5=Access Denied, 32=File in use)")
} else {
  Write-Output ("HRESULT complet: " + $hr)
}
[NativeDll]::FreeLibrary($h) | Out-Null
