# Test C# fiable : enumeration WinRT des cameras video (ce que WhatsApp/Chromium voient)
$cs = @'
using System;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;

public static class CamEnum {
    public static string[] Enumerate() {
        try {
            var t = DeviceInformation.FindAllAsync(DeviceClass.VideoCapture).AsTask();
            t.Wait(10000);
            var devs = t.Result;
            string[] names = new string[devs.Count];
            for (int i = 0; i < devs.Count; i++) {
                names[i] = devs[i].Name;
            }
            return names;
        } catch (Exception ex) {
            return new string[] { "ERR: " + ex.Message };
        }
    }
}
'@
Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
Add-Type -TypeDefinition $cs -ReferencedAssemblies 'System.Runtime.WindowsRuntime' -ErrorAction Stop

$result = [CamEnum]::Enumerate()
Write-Output ("Cameras vues via WinRT (comme WhatsApp): " + $result.Count)
foreach ($r in $result) { Write-Output ("  - " + $r) }
