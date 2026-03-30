import { dotnet } from "./_framework/dotnet.js";
let godotInstance = null;
const { setModuleImports, getConfig, runMain } = await dotnet
  .withApplicationArguments("start")
  .create();
setModuleImports("main.js", {
  godotBridge: {
    loadGodot: async () => {
      console.log("JS: Loading Godot engine...");
      const script = document.createElement("script");
      script.src = "godot.js";
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      console.log("JS: Godot script loaded, checking for Godot factory...");
      if (typeof window.Godot !== "undefined") {
        console.log("JS: Godot factory found! Initializing...");
        try {
          const module = await window.Godot({
            canvas: document.getElementById("canvas"),
            locateFile: (path) => {
              console.log("JS: Godot requesting file:", path);
              return path;
            },
            print: (text) => console.log("Godot:", text),
            printErr: (text) => console.error("Godot:", text),
          });
          godotInstance = module;
          console.log("JS: Godot main module initialized!");
          console.log(
            "JS: Module keys:",
            Object.keys(module).filter(
              (k) =>
                k.includes("libgodot") ||
                k.includes("loadDynamic") ||
                k.includes("HEAPU8"),
            ),
          );

          // Load the side module containing actual Godot engine + LibGodot
          if (module.loadDynamicLibrary) {
            console.log(
              "JS: loadDynamicLibrary available, loading side module...",
            );
            await module.loadDynamicLibrary("godot.side.wasm", {
              loadAsync: true,
              global: true,
              nodelete: true,
              allowUndefined: true,
            });
            console.log("JS: Side module loaded!");

            // Explore GOT structure
            if (module.GOT) {
              console.log("JS: GOT keys:", Object.keys(module.GOT));
              console.log(
                "JS: GOT.libgodot_create_godot_instance:",
                module.GOT.libgodot_create_godot_instance,
              );

              const gotEntry = module.GOT.libgodot_create_godot_instance;
              if (gotEntry) {
                console.log("JS: GOT entry type:", typeof gotEntry);
                console.log("JS: GOT entry value:", gotEntry.value);
                console.log(
                  "JS: GOT entry:",
                  JSON.stringify(Object.getOwnPropertyNames(gotEntry)),
                );
              }
            } else {
              console.log("JS: No GOT");
            }

            // Try cwrap
            if (module.cwrap) {
              try {
                const fn = module.cwrap(
                  "libgodot_create_godot_instance",
                  "number",
                  ["number", "number", "number"],
                );
                console.log("JS: cwrap result:", fn);
                console.log("JS: cwrap type:", typeof fn);
                if (typeof fn === "function") {
                  module._libgodot_create_godot_instance = fn;
                  console.log("JS: Wired up via cwrap!");
                }
              } catch (e) {
                console.log("JS: cwrap error:", e.message);
              }
            }

            // Try getValue with GOT pointer
            if (
              module.GOT &&
              module.GOT.libgodot_create_godot_instance &&
              module.wasmTable
            ) {
              const ptr = module.GOT.libgodot_create_godot_instance.value;
              console.log("JS: Function pointer:", ptr);
              const fn = module.wasmTable.get(ptr);
              console.log("JS: wasmTable.get:", fn, typeof fn);
              if (typeof fn === "function") {
                module._libgodot_create_godot_instance = fn;
                console.log("JS: Wired up via wasmTable!");
              }
            }

            // Direct test - the previous run showed _libgodot_create_godot_instance in keys but undefined
            // Maybe it's a getter? Check property descriptor
            const desc = Object.getOwnPropertyDescriptor(
              module,
              "_libgodot_create_godot_instance",
            );
            console.log("JS: Property descriptor:", desc);

            if (module._libgodot_create_godot_instance) {
              console.log("JS: LibGodot entry points available!");
            } else {
              console.log("JS: Checking for libgodot exports...");
              console.log(
                "JS: libgodot matches:",
                Object.keys(module).filter((k) => k.includes("libgodot")),
              );
              console.log(
                "JS: _libgodot matches:",
                Object.keys(module).filter((k) => k.includes("_libgodot")),
              );
              // Also check if it landed on the asm/exports object directly
              if (module.asm) {
                console.log(
                  "JS: asm.libgodot matches:",
                  Object.keys(module.asm).filter((k) => k.includes("libgodot")),
                );
              }
              // Try accessing it directly both ways
              console.log(
                "JS: direct _libgodot_create_godot_instance:",
                typeof module._libgodot_create_godot_instance,
              );
              console.log(
                "JS: direct libgodot_create_godot_instance:",
                typeof module.libgodot_create_godot_instance,
              );
              console.log(
                "JS: direct _libgodot_create_godot_instance (bracket):",
                typeof module["_libgodot_create_godot_instance"],
              );
            }
          } else {
            console.error("JS: loadDynamicLibrary not available on module");
            console.log(
              "JS: Available module methods:",
              Object.keys(module).slice(0, 30),
            );
          }
        } catch (e) {
          console.error("JS: Godot init failed:", e.message);
          throw e;
        }
      } else {
        console.error("JS: No Godot factory function found on window");
        throw new Error("Godot factory not available");
      }
    },
    createInstance: () => {
      if (!godotInstance) {
        console.error("JS: Godot module not loaded");
        return -1;
      }
      if (godotInstance._libgodot_create_godot_instance) {
        console.log("JS: Calling libgodot_create_godot_instance...");
        const ptr = godotInstance._libgodot_create_godot_instance(0, 0, 0);
        console.log("JS: Got instance pointer:", ptr);
        return ptr;
      }
      console.log("JS: libgodot_create_godot_instance not found");
      return 0;
    },
  },
});
await runMain();
