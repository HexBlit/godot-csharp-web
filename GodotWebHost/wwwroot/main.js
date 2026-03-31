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

      godotInstance = module;
      console.log("JS: Godot main module initialized!");

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

      // Wire up LibGodot entry points via GOT + wasmTable
      if (module.GOT && module.wasmTable) {
        const createGot = module.GOT.libgodot_create_godot_instance;
        const destroyGot = module.GOT.libgodot_destroy_godot_instance;
        const initGot = module.GOT.minimal_gdextension_init;

        if (createGot) {
          module._libgodot_create_godot_instance = module.wasmTable.get(
            createGot.value,
          );
          console.log("JS: Wired up libgodot_create_godot_instance");
        }
        if (destroyGot) {
          module._libgodot_destroy_godot_instance = module.wasmTable.get(
            destroyGot.value,
          );
          console.log("JS: Wired up libgodot_destroy_godot_instance");
        }
        if (initGot) {
          console.log(
            "JS: Wired up minimal_gdextension_init, table index:",
            initGot.value,
          );
        } else {
          console.warn("JS: minimal_gdextension_init not found in GOT");
        }
      }

      if (!module._libgodot_create_godot_instance) {
        throw new Error(
          "LibGodot entry points not found after loading side module",
        );
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
      if (!godotInstance) {
        console.error("JS: Godot module not loaded");
        return -1;
      }
      if (!godotInstance._libgodot_create_godot_instance) {
        console.error("JS: libgodot_create_godot_instance not found");
        return 0;
      }

      console.log("JS: Calling libgodot_create_godot_instance...");

      // Helper to allocate a C string in WASM memory
      const allocStr = (str) => {
        const len = str.length + 1;
        const ptr = godotInstance._malloc(len);
        for (let i = 0; i < str.length; i++) {
          godotInstance.HEAPU8[ptr + i] = str.charCodeAt(i);
        }
        godotInstance.HEAPU8[ptr + str.length] = 0;
        return ptr;
      };

      // Build argv: ["godot", "--main-pack", "/game.pck"]
      const arg0 = allocStr("godot");
      const arg1 = allocStr("--main-pack");
      const arg2 = allocStr("/game.pck");

      // Create argv array (3 pointers, 4 bytes each)
      const argvPtr = godotInstance._malloc(3 * 4);
      const HEAP32 = new Int32Array(godotInstance.HEAPU8.buffer);
      HEAP32[argvPtr >> 2] = arg0;
      HEAP32[(argvPtr >> 2) + 1] = arg1;
      HEAP32[(argvPtr >> 2) + 2] = arg2;

      // Get the init function pointer from GOT (WASM table index)
      const initPtr =
        godotInstance.GOT && godotInstance.GOT.minimal_gdextension_init
          ? godotInstance.GOT.minimal_gdextension_init.value
          : 0;
      console.log("JS: Using init function pointer:", initPtr);

      const ptr = godotInstance._libgodot_create_godot_instance(
        3,
        argvPtr,
        initPtr,
      );
      console.log("JS: Got instance pointer:", ptr);

      // Clean up allocated strings
      godotInstance._free(arg0);
      godotInstance._free(arg1);
      godotInstance._free(arg2);
      godotInstance._free(argvPtr);

      return ptr;
    },
  },
});

await runMain();
