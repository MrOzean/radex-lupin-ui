"use strict";

// Metrology capture: passively logs the EsEapData RTTI getter return values
// (doubles returned via x87, read from [ebp-8] at the trailing fld site) and
// the raw serial stream, so official RadexLight values can be correlated with
// candidate formulas computed on the very same packets.
//
// NOTE: actively calling the getters from a Frida timer (NativeFunction
// trampolines) crashed RadexLight within seconds. Passive logging only.

function report(kind, fields) {
  send(Object.assign({ kind }, fields || {}));
}

function hex(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const exe = Process.getModuleByName("radexlight.exe");

// [name, trailing fld-site RVA] — read the returned double from [ebp-8].
const GETTERS = [
  ["minimum", 0x81b721],
  ["maximum", 0x81b579],
  ["meanArithmetic", 0x81b5fd],
  ["meanIntegral", 0x81b691],
  ["flickerArithmetic", 0x81bb0d],
  ["flickerIntegral", 0x81bba5],
];

const lastValues = new Map();

for (const [name, rva] of GETTERS) {
  Interceptor.attach(exe.base.add(rva), {
    onEnter() {
      let value = NaN;
      try {
        value = this.context.ebp.sub(8).readDouble();
      } catch (_) {}
      if (!Number.isFinite(value)) return;
      const previous = lastValues.get(name);
      if (previous !== undefined && Math.abs(previous - value) <= 1e-9) return;
      lastValues.set(name, value);
      report("official", { name, value });
    },
  });
}

// --- serial stream logging ---
// RadexLight opens the port as "\\?\COM5" through kernelbase (kernel32 just
// forwards), so hook kernelbase only: it is the single real implementation
// and avoids double-reporting reads.

const serialHandles = new Set();
let serialModule;
try {
  serialModule = Process.getModuleByName("kernelbase.dll");
} catch (_) {
  serialModule = Process.getModuleByName("kernel32.dll");
}
const SERIAL_PATH = /^\\\\[.?]\\COM\d+/i;

const createFile = serialModule.getExportByName("CreateFileW");
Interceptor.attach(createFile, {
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

const readFile = serialModule.getExportByName("ReadFile");
Interceptor.attach(readFile, {
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

report("ready", { architecture: Process.arch, pointerSize: Process.pointerSize });
