import { dotnet } from "./_framework/dotnet.js";

let godotModule = null;
let engineRunning = false;

const { setModuleImports, getConfig, runMain } = await dotnet
  .withApplicationArguments("start")
  .create();

// Helper to resolve a GOT symbol to a callable function via wasmTable
function resolveGotFunc(name) {
  if (godotModule && godotModule.GOT && godotModule.wasmTable) {
    const entry = godotModule.GOT[name];
    if (entry) {
      return godotModule.wasmTable.get(entry.value);
    }
  }
  return null;
}

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
      if (typeof window.Godot === "undefined") {
        throw new Error("Godot factory not available");
      }

      console.log("JS: Godot factory found! Initializing...");
      const module = await window.Godot({
        canvas: document.getElementById("canvas"),
        locateFile: (path) => {
          console.log("JS: Godot requesting file:", path);
          return path;
        },
        print: (text) => console.log("Godot:", text),
        printErr: (text) => console.error("Godot:", text),
      });

      godotModule = module;
      console.log("JS: Godot main module initialized!");

      // Initialize Godot's internal config with the canvas element.
      // This is normally done by engine.js but we're bypassing it.
      const canvas = document.getElementById("canvas");
      if (module.initConfig) {
        module.initConfig({
          canvas: canvas,
          canvasResizePolicy: 0, // None - we control canvas size
          locale: navigator.language || "en",
          virtualKeyboard: false,
          persistentDrops: false,
          focusCanvas: true,
        });
        console.log("JS: initConfig called with canvas:", canvas.id);
      } else {
        console.warn("JS: initConfig not available on module");
      }

      // Load the side module containing Godot engine + LibGodot
      if (!module.loadDynamicLibrary) {
        throw new Error("loadDynamicLibrary not available");
      }

      console.log("JS: Loading side module...");
      await module.loadDynamicLibrary("godot.side.wasm", {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: true,
      });
      console.log("JS: Side module loaded!");

      // Wire up all LibGodot entry points via GOT + wasmTable
      const symbols = [
        "libgodot_create_godot_instance",
        "libgodot_destroy_godot_instance",
        "minimal_gdextension_init",
        "libgodot_web_start",
        "libgodot_web_iteration",
        "libgodot_web_stop",
      ];

      for (const name of symbols) {
        const fn = resolveGotFunc(name);
        if (fn) {
          module["_" + name] = fn;
          console.log(`JS: Wired up ${name}`);
        } else {
          console.warn(`JS: ${name} not found in GOT`);
        }
      }

      if (!module._libgodot_create_godot_instance) {
        throw new Error("LibGodot entry points not found after loading side module");
      }

      console.log("JS: LibGodot entry points ready!");

      // Pre-load the .pck file into Emscripten's virtual filesystem
      console.log("JS: Loading .pck into VFS...");
      const pckResponse = await fetch("game.pck");
      if (!pckResponse.ok) {
        console.warn("JS: No game.pck found (expected for first test)");
      } else {
        const pckData = new Uint8Array(await pckResponse.arrayBuffer());
        console.log("JS: .pck loaded, size:", pckData.length);

        if (module.FS) {
          module.FS.writeFile("/game.pck", pckData);
          module.FS.writeFile("/project.godot", "");
          console.log("JS: .pck and project.godot written to VFS");
        } else {
          console.error("JS: No FS available on module");
        }
      }
    },

    createInstance: () => {
      if (!godotModule || !godotModule._libgodot_create_godot_instance) {
        console.error("JS: Godot module not loaded or entry points missing");
        return -1;
      }

      console.log("JS: Calling libgodot_create_godot_instance...");

      // Helper to allocate a C string in WASM memory
      const allocStr = (str) => {
        const len = str.length + 1;
        const ptr = godotModule._malloc(len);
        for (let i = 0; i < str.length; i++) {
          godotModule.HEAPU8[ptr + i] = str.charCodeAt(i);
        }
        godotModule.HEAPU8[ptr + str.length] = 0;
        return ptr;
      };

      // Build argv: ["godot", "--main-pack", "/game.pck"]
      const arg0 = allocStr("godot");
      const arg1 = allocStr("--main-pack");
      const arg2 = allocStr("/game.pck");

      // Create argv array (3 pointers, 4 bytes each)
      const argvPtr = godotModule._malloc(3 * 4);
      const HEAP32 = new Int32Array(godotModule.HEAPU8.buffer);
      HEAP32[argvPtr >> 2] = arg0;
      HEAP32[(argvPtr >> 2) + 1] = arg1;
      HEAP32[(argvPtr >> 2) + 2] = arg2;

      // Get the init function pointer from GOT (WASM table index)
      const initPtr =
        godotModule.GOT && godotModule.GOT.minimal_gdextension_init
          ? godotModule.GOT.minimal_gdextension_init.value
          : 0;
      console.log("JS: Using init function pointer:", initPtr);

      const ptr = godotModule._libgodot_create_godot_instance(3, argvPtr, initPtr);
      console.log("JS: Got instance pointer:", ptr);

      // Clean up allocated strings
      godotModule._free(arg0);
      godotModule._free(arg1);
      godotModule._free(arg2);
      godotModule._free(argvPtr);

      return ptr;
    },

    startEngine: () => {
      if (!godotModule || !godotModule._libgodot_web_start) {
        console.error("JS: libgodot_web_start not available");
        return 0;
      }

      console.log("JS: Calling libgodot_web_start...");
      const result = godotModule._libgodot_web_start();
      console.log("JS: libgodot_web_start returned:", result);

      if (result === 1) {
        // Start the render loop
        engineRunning = true;
        console.log("JS: Starting requestAnimationFrame render loop...");
        requestAnimationFrame(renderLoop);
      }

      return result;
    },

    stopEngine: () => {
      console.log("JS: Stopping engine...");
      engineRunning = false;
      if (godotModule && godotModule._libgodot_web_stop) {
        godotModule._libgodot_web_stop();
      }
    },
  },
});

function renderLoop() {
  if (!engineRunning || !godotModule || !godotModule._libgodot_web_iteration) {
    return;
  }

  try {
    // iteration() returns 0 to continue, non-zero to quit
    const shouldQuit = godotModule._libgodot_web_iteration();
    if (shouldQuit) {
      console.log("JS: Engine requested quit");
      engineRunning = false;
      if (godotModule._libgodot_web_stop) {
        godotModule._libgodot_web_stop();
      }
      return;
    }
  } catch (e) {
    console.error("JS: Error during iteration:", e.message);
    engineRunning = false;
    return;
  }

  requestAnimationFrame(renderLoop);
}

await runMain();
