$log = 'C:\chapcam2\chapcam-kz\akvcam-hr.log'
"=== DllRegisterServer admin $(Get-Date) ===" | Out-File $log -Encoding utf8

# Etat Smart App Control / policy
try {
  $sac = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop
  "SAC VerifiedAndReputablePolicyState: " + $sac.VerifiedAndReputablePolicyState | Out-File $log -Append
} catch { "SAC: cle absente" | Out-File $log -Append }

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class NativeDll2 {
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
$h = [NativeDll2]::LoadLibrary($dll)
if ($h -eq [IntPtr]::Zero) {
  "LoadLibrary ECHEC: " + [Runtime.InteropServices.Marshal]::GetLastWin32Error() | Out-File $log -Append
  exit 1
}
"LoadLibrary OK" | Out-File $log -Append
$addr = [NativeDll2]::GetProcAddress($h, 'DllRegisterServer')
if ($addr -eq [IntPtr]::Zero) {
  "DllRegisterServer absent" | Out-File $log -Append
} else {
  $del = [Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($addr, [NativeDll2+DllRegisterServerDelegate])
  $hr = $del.Invoke()
  ("DllRegisterServer HRESULT: 0x{0:X8}" -f ($hr -band 0xFFFFFFFF)) | Out-File $log -Append
  if (($hr -band 0xFFFF0000) -eq 0x80070000) {
    ("  = Win32 error " + ($hr -band 0xFFFF) + " (5=Access Denied)") | Out-File $log -Append
  }
}
[NativeDll2]::FreeLibrary($h) | Out-Null
"FINI" | Out-File $log -Append
