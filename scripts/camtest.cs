using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;

public class CamTest
{
    public static int Main(string[] args)
    {
        try
        {
            var op = DeviceInformation.FindAllAsync(DeviceClass.VideoCapture);
            var task = op.AsTask();
            task.Wait(10000);
            var devices = task.Result;
            Console.WriteLine("Cameras WinRT (comme WhatsApp): " + devices.Count);
            foreach (var d in devices)
            {
                Console.WriteLine("  - " + d.Name);
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("ERR: " + ex.Message);
            return 1;
        }
    }
}
