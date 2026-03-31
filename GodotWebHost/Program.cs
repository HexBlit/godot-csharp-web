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
    int instancePtr = GodotBridge.CreateInstance();
    Console.WriteLine($"GodotWebHost: CreateInstance returned: {instancePtr}");

    if (instancePtr > 0)
    {
        Console.WriteLine("GodotWebHost: Starting engine...");
        int startResult = GodotBridge.StartEngine();
        Console.WriteLine($"GodotWebHost: StartEngine returned: {startResult}");

        if (startResult == 1)
        {
            Console.WriteLine("GodotWebHost: Engine running! Render loop active via requestAnimationFrame.");
        }
        else
        {
            Console.WriteLine("GodotWebHost: Engine failed to start.");
        }
    }
    else
    {
        Console.WriteLine("GodotWebHost: Failed to create Godot instance.");
    }
}
catch (Exception ex)
{
    Console.WriteLine($"GodotWebHost: Error - {ex.GetType().Name}: {ex.Message}");
}

// Keep the .NET runtime alive while the engine runs
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

    [JSImport("godotBridge.startEngine", "main.js")]
    public static partial int StartEngine();

    [JSImport("godotBridge.stopEngine", "main.js")]
    public static partial void StopEngine();
}
