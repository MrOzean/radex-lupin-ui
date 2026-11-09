"use strict";

function hex(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function report(kind, fields) {
  send(Object.assign({ kind }, fields || {}));
}

function exportOn(moduleName, name) {
  const module = Process.getModuleByName(moduleName);
  const address = module.getExportByName(name);
  if (!address) throw new Error(`Export not found: ${moduleName}!${name}`);
  return address;
}

const serialHandles = new Set();

["kernel32.dll"].forEach((moduleName) => {
  let module;
  try {
    module = Process.getModuleByName(moduleName);
  } catch (_) {
    return;
  }

  ["CreateFileW", "SetCommState", "SetCommTimeouts", "PurgeComm", "EscapeCommFunction", "WriteFile", "ReadFile"].forEach((name) => {
    let address;
    try {
      address = module.getExportByName(name);
    } catch (_) {
      return;
    }
    if (!address || address.isNull()) return;

    if (name === "CreateFileW") {
      Interceptor.attach(address, {
        onEnter(args) {
          this.path = args[0].readUtf16String();
          this.isSerial = /^(\\\\\.\\)?COM\d+/i.test(this.path || "");
        },
        onLeave(retval) {
          if (this.isSerial) {
            const handle = retval.toString();
            serialHandles.add(handle);
            report("open", { module: moduleName, path: this.path, handle });
          }
        },
      });
    } else if (name === "SetCommState") {
      Interceptor.attach(address, {
        onEnter(args) {
          serialHandles.add(args[0].toString());
          const dcb = args[1];
          report("comm-state", {
            module: moduleName,
            handle: args[0].toString(),
            baudRate: dcb.add(4).readU32(),
            flags: dcb.add(8).readU32(),
            byteSize: dcb.add(18).readU8(),
            parity: dcb.add(19).readU8(),
            stopBits: dcb.add(20).readU8(),
          });
        },
      });
    } else if (name === "SetCommTimeouts") {
      Interceptor.attach(address, {
        onEnter(args) {
          const timeouts = args[1];
          report("comm-timeouts", {
            module: moduleName,
            handle: args[0].toString(),
            values: [0, 1, 2, 3, 4].map((index) => timeouts.add(index * 4).readU32()),
          });
        },
      });
    } else if (name === "PurgeComm" || name === "EscapeCommFunction") {
      Interceptor.attach(address, {
        onEnter(args) {
          report(name === "PurgeComm" ? "purge" : "escape", {
            module: moduleName,
            handle: args[0].toString(),
            operation: args[1].toUInt32(),
          });
        },
      });
    } else if (name === "WriteFile") {
      Interceptor.attach(address, {
        onEnter(args) {
          const handle = args[0].toString();
          if (!serialHandles.has(handle)) return;
          const length = args[2].toUInt32();
          report("write", {
            module: moduleName,
            handle,
            length,
            hex: length > 0 ? hex(args[1].readByteArray(length)) : "",
          });
        },
      });
    } else if (name === "ReadFile") {
      Interceptor.attach(address, {
        onEnter(args) {
          this.handle = args[0].toString();
          this.skip = !serialHandles.has(this.handle);
          if (this.skip) return;
          this.buffer = args[1];
          this.requested = args[2].toUInt32();
          this.countPointer = args[3];
          this.overlapped = args[4];
        },
        onLeave(retval) {
          if (this.skip) return;
          let count = 0;
          if (!this.countPointer.isNull()) {
            try {
              count = this.countPointer.readU32();
            } catch (_) {}
          }
          if (count > 0) {
            report("read", {
              module: moduleName,
              handle: this.handle,
              requested: this.requested,
              length: count,
              async: !this.overlapped.isNull(),
              success: retval.toUInt32() !== 0,
              hex: hex(this.buffer.readByteArray(count)),
            });
          }
        },
      });
    }
  });
});

report("ready", { architecture: Process.arch, pointerSize: Process.pointerSize });
