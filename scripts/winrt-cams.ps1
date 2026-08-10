# Enumeration WinRT fiable : technique [WindowsRuntimeSystemExtensions]::AsTask
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop

  # Charge la projection des types WinRT
  [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null

  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)

  # AsTask via la methode d'extension
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $t = $asTaskGeneric.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.Enumeration.DeviceInformation]])
  $netTask = $t.Invoke($null, @($op))
  $netTask.Wait(10000) | Out-Null
  $devs = $netTask.Result

  Write-Output ("Cameras WinRT: " + $devs.Count)
  foreach ($d in $devs) {
    Write-Output ("  - " + $d.Name)
  }
} catch {
  Write-Output ("ERR: " + $_.Exception.Message)
  if ($_.Exception.InnerException) { Write-Output ("  inner: " + $_.Exception.InnerException.Message) }
}
