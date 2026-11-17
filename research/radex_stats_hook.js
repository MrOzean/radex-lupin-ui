"use strict";

// Dumps EsEapData script-variant payloads for properties the RadexLight UI
// reads through the script dispatcher, and logs the scalar RTTI getters via
// their trailing `fld qword ptr [ebp-8]` sites.
//
// Dispatcher convention: dispatcher(eax=obj, edx=nameUTF16, ecx=&outVariant).
// The variant object layout is unknown, so raw bytes are dumped and decoded
// offline against the known meanIntegral values from the getter hooks.

function report(kind, fields) {
  send(Object.assign({ kind }, fields || {}));
}

function hex(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const exe = Process.getModuleByName("radexlight.exe");

const GETTER_ENTRIES = [
  ["minimum", 0x81b6c4, 0x81b721],
  ["maximum", 0x81b51c, 0x81b579],
  ["meanArithmetic", 0x81b5a0, 0x81b5fd],
  ["meanIntegral", 0x81b634, 0x81b691],
  ["flickerArithmetic", 0x81bab0, 0x81bb0d],
  ["flickerIntegral", 0x81bb48, 0x81bba5],
];

const DUMP = new Set([
  "lumDiv", "dataType", "devType", "total",
  "minimum", "maximum", "flickerIntegral", "meanIntegral",
  "flicker", "illuminance", "luminance",
]);

let dispatcherAddress = null;
let dispatcherHooked = false;
const lastValues = new Map();
const lastRaw = new Map();
const knownNames = new Set();

function moduleRange(ptrValue) {
  return !ptrValue.isNull()
    && ptrValue.compare(exe.base) >= 0
    && ptrValue.compare(exe.base.add(exe.size)) < 0;
}

function remember(name, value) {
  if (!Number.isFinite(value)) return;
  const previous = lastValues.get(name);
  if (previous !== undefined && Math.abs(previous - value) <= 1e-9) return;
  lastValues.set(name, value);
  report("property-value", { name, value });
}

function hookDispatcher() {
  if (dispatcherHooked || !dispatcherAddress) return;
  dispatcherHooked = true;
  Interceptor.attach(dispatcherAddress, {
    onEnter() {
      let name = "";
      try {
        name = this.context.edx.readUtf16String() || "";
      } catch (_) {}
      this.name = name;
      this.outPtr = this.context.ecx;
    },
    onLeave() {
      if (!this.name || !DUMP.has(this.name)) return;
      if (!knownNames.has(this.name)) {
        knownNames.add(this.name);
        report("property", { name: this.name, firstSeen: true });
      }
      try {
        const variant = this.outPtr.readPointer();
        if (variant.isNull()) return;
        const raw = variant.readByteArray(48);
        const bytes = new Uint8Array(raw);
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        if (lastRaw.get(this.name) === hex) return;
        lastRaw.set(this.name, hex);
        const vtable = variant.readPointer();
        // The variant references its payload through a heap pointer at +12;
        // dump it too so the value offset can be decoded offline.
        let payloadHex = "";
        try {
          const inner = variant.add(12).readPointer();
          if (!inner.isNull()) {
            payloadHex = Array.from(new Uint8Array(inner.readByteArray(32)),
              (b) => b.toString(16).padStart(2, "0")).join("");
          }
        } catch (_) {}
        report("property-raw", {
          name: this.name,
          hex,
          payloadHex,
          vtable: moduleRange(vtable) ? vtable.toString() : "external",
        });
      } catch (_) {}
    },
  });
  report("dispatcher-hooked", { address: dispatcherAddress.toString() });
}

for (const [name, entryRva, fldRva] of GETTER_ENTRIES) {
  Interceptor.attach(exe.base.add(entryRva), {
    onEnter() {
      try {
        const obj = this.context.eax.add(0x24).readPointer();
        const vtable = obj.readPointer();
        const candidate = vtable.add(0x174).readPointer();
        if (moduleRange(candidate)) {
          dispatcherAddress = candidate;
          hookDispatcher();
        }
      } catch (_) {}
    },
  });
  Interceptor.attach(exe.base.add(fldRva), {
    onEnter() {
      let value = NaN;
      try {
        value = this.context.ebp.sub(8).readDouble();
      } catch (_) {}
      remember(name, value);
    },
  });
}

// --- serial stream logging ---
// RadexLight opens the port as "\\?\COM5" via kernelbase (kernel32 forwards),
// so hook kernelbase only: single real implementation, no double-reporting.

const serialHandles = new Set();
let serialModule;
try {
  serialModule = Process.getModuleByName("kernelbase.dll");
} catch (_) {
  serialModule = Process.getModuleByName("kernel32.dll");
}
const SERIAL_PATH = /^\\\\[.?]\\COM\d+/i;

Interceptor.attach(serialModule.getExportByName("CreateFileW"), {
  onEnter(args) {
    this.path = args[0].readUtf16String();
    this.isSerial = SERIAL_PATH.test(this.path || "");
  },
  onLeave(retval) {
    if (this.isSerial) {
      const handle = retval.toString();
      serialHandles.add(handle);
      report("open", { path: this.path, handle });
    }
  },
});

Interceptor.attach(serialModule.getExportByName("ReadFile"), {
  onEnter(args) {
    this.handle = args[0].toString();
    this.skip = !serialHandles.has(this.handle);
    if (this.skip) return;
    this.buffer = args[1];
    this.countPointer = args[3];
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
        handle: this.handle,
        length: count,
        hex: hex(this.buffer.readByteArray(count)),
      });
    }
  },
});

Interceptor.attach(serialModule.getExportByName("WriteFile"), {
  onEnter(args) {
    if (!serialHandles.has(args[0].toString())) return;
    report("write", { handle: args[0].toString(), length: args[2].toUInt32() });
  },
});

report("ready", { architecture: Process.arch, pointerSize: Process.pointerSize });
