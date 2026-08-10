# Enumerer les cameras video exactement comme WhatsApp (WinRT DeviceInformation).
# PowerShell 5.1 : il faut passer par [System.WindowsRuntimeSystemExtensions]::AsTask.
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

  [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null

  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)
  $task = $asTaskGeneric.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.Enumeration.DeviceInformation]]).Invoke($null, @($op))
  $task.Wait(10000) | Out-Null
  $devs = $task.Result
  Write-Output ("WinRT cameras trouvees: " + $devs.Count)
  foreach ($d in $devs) {
    Write-Output ("  - " + $d.Name + "  [" + $d.Id.Substring(0, [Math]::Min(40, $d.Id.Length)) + "]")
  }
} catch {
  Write-Output ("ERR: " + $_.Exception.ToString())
}
