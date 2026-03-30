using System;
using System.Runtime.InteropServices.JavaScript;
using System.Threading.Tasks;

Console.WriteLine("GodotWebHost: .NET WASM runtime initialized");

try
{
    Console.WriteLine("GodotWebHost: Loading LibGodot side module...");
    await GodotBridge.LoadGodotAsync();
    Console.WriteLine("GodotWebHost: LibGodot loaded successfully!");

    Console.WriteLine("GodotWebHost: Creating Godot instance...");
    int result = GodotBridge.CreateInstance();
    Console.WriteLine($"GodotWebHost: CreateInstance returned: {result}");
}
catch (Exception ex)
{
    Console.WriteLine($"GodotWebHost: Error - {ex.GetType().Name}: {ex.Message}");
}

while (true)
{
    await Task.Delay(1000);
}

partial class GodotBridge
{
    [JSImport("godotBridge.loadGodot", "main.js")]
    public static partial Task LoadGodotAsync();

    [JSImport("godotBridge.createInstance", "main.js")]
    public static partial int CreateInstance();
}
