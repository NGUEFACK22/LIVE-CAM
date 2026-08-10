Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnumProbe {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@

$rows = New-Object System.Collections.ArrayList
$cb = {
  param($hwnd, $lparam)
  $t = New-Object System.Text.StringBuilder 512
  $c = New-Object System.Text.StringBuilder 256
  [WinEnumProbe]::GetWindowText($hwnd, $t, 512) | Out-Null
  [WinEnumProbe]::GetClassName($hwnd, $c, 256) | Out-Null
  $pid2 = 0
  [WinEnumProbe]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
  $title = $t.ToString()
  $cls = $c.ToString()
  $visible = [WinEnumProbe]::IsWindowVisible($hwnd)
  $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
  $exe = if ($p) { $p.ProcessName } else { '?' }
  $probe = "$title|$cls|$pid2|$exe|$visible"
  if ($title -match 'hapCam' -or $exe -match 'hapCam' -or $exe -match 'obs64' -or $exe -match 'whatsapp' -or $exe -match 'WhatsApp') {
    [void]$rows.Add($probe)
  }
  return $true
}
[WinEnumProbe]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$rows | Sort-Object
