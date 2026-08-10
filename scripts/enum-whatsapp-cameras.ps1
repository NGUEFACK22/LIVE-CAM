# Enumerer les cameras video comme le fait WhatsApp Desktop.
# Methode 1 : Windows.Devices.Enumeration (WinRT) via l'adaptateur .NET.
# Methode 2 : Get-PnpDevice (fallback fiable).
try {
  [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
  $task = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)
  $task.GetAwaiter().GetResult() | Out-Null
  $devs = $task.GetResults()
  Write-Output ("WinRT cameras: " + $devs.Count)
  foreach ($d in $devs) { Write-Output ("  - " + $d.Name) }
} catch {
  Write-Output ("WinRT ERR: " + $_.Exception.Message)
}
Write-Output "---"
# Fallback PnP (classe Camera/Image = ce que Media Foundation expose)
try {
  Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
    Where-Object { ($_.Class -in @('Camera','Image')) -or ($_.FriendlyName -match 'ChapCam|OBS') } |
    ForEach-Object { Write-Output ("PNP: " + $_.FriendlyName + " [" + $_.Status + "]") }
} catch { Write-Output ("PNP ERR: " + $_.Exception.Message) }
