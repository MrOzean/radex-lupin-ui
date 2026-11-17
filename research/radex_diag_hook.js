"use strict";

// Diagnostic: log every CreateFileW path and every SetCommState baud rate to
// see how RadexLight actually opens the LUPIN port on this system.

function report(kind, fields) {
  send(Object.assign({ kind }, fields || {}));
}

const seen = new Set();
for (const moduleName of ["kernel32.dll", "kernelbase.dll"]) {
  let module;
  try {
    module = Process.getModuleByName(moduleName);
  } catch (_) {
    continue;
  }

  const createFile = module.getExportByName("CreateFileW");
  if (createFile && !createFile.isNull()) {
    Interceptor.attach(createFile, {
      onEnter(args) {
        let path = "";
        try {
          path = args[0].readUtf16String() || "";
        } catch (_) {}
        if (/com\d|usb|abba/i.test(path)) {
          report("createfile", { module: moduleName, path });
        }
      },
    });
  }

  const setCommState = module.getExportByName("SetCommState");
  if (setCommState && !setCommState.isNull()) {
    Interceptor.attach(setCommState, {
      onEnter(args) {
        report("comm-state", { module: moduleName, baud: args[1].add(4).readU32() });
      },
    });
  }
}

report("ready", {});
