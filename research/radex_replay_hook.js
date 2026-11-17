"use strict";

// Replays the recorded LUPIN oscilloscope stream (passive-com5.bin) into the
// official RadexLight via a ReadFile hook and logs the EsEapData scalar
// getters (minimum/maximum/mean/flicker) so the official formulas can be
// compared against candidate formulas computed on the same packets.
//
// Getter hooks: each EsEapData getter ends with
//   fstp qword ptr [ebp-8] / ... / fld qword ptr [ebp-8] / ret
// Hooking the fld and reading [ebp-8] yields the returned double (RVA offsets,
// PE image base 0x400000).

function hex(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function report(kind, fields) {
  send(Object.assign({ kind }, fields || {}));
}

const GETTERS = [
  ["minimum", 0x81b721],
  ["maximum", 0x81b579],
  ["meanArithmetic", 0x81b5fd],
  ["meanIntegral", 0x81b691],
  ["flickerArithmetic", 0x81bb0d],
  ["flickerIntegral", 0x81bba5],
];

const exe = Process.getModuleByName("radexlight.exe");
for (const [name, rva] of GETTERS) {
  const address = exe.base.add(rva);
  Interceptor.attach(address, {
    onEnter() {
      let value = NaN;
      try {
        value = this.context.ebp.sub(8).readDouble();
      } catch (_) {}
      report("stat", { name, value });
    },
  });
}

// --- replay state ---
const replay = { data: null, offset: 0, handle: null, baud: 0 };
const kernel32 = Process.getModuleByName("kernel32.dll");
const setCommState = kernel32.getExportByName("SetCommState");

Interceptor.attach(setCommState, {
  onEnter(args) {
    const handle = args[0].toString();
    const baud = args[1].add(4).readU32();
    if (replay.handle === handle) {
      replay.baud = baud;
      if (baud === 921600) {
        replay.offset = 0;
        report("replay-reset", {});
      }
      report("baud", { handle, baud });
    }
  },
});

const createFileW = kernel32.getExportByName("CreateFileW");
Interceptor.attach(createFileW, {
  onEnter(args) {
    this.path = args[0].readUtf16String();
    this.isSerial = /^(\\\\\.\\)?COM\d+/i.test(this.path || "");
  },
  onLeave(retval) {
    if (this.isSerial) {
      const handle = retval.toString();
      report("open", { path: this.path, handle });
      if (replay.handle === null) {
        replay.handle = handle;
        replay.offset = 0;
      }
    }
  },
});

const readFile = kernel32.getExportByName("ReadFile");
Interceptor.attach(readFile, {
  onEnter(args) {
    this.handle = args[0].toString();
    this.isSerial = this.handle === replay.handle;
    if (!this.isSerial) return;
    this.buffer = args[1];
    this.requested = args[2].toUInt32();
    this.countPointer = args[3];
    this.overlapped = args[4];
  },
  onLeave(retval) {
    if (!this.isSerial) return;
    let count = 0;
    if (!this.countPointer.isNull()) {
      try {
        count = this.countPointer.readU32();
      } catch (_) {}
    }
    if (count > 0) {
      report("read-real", { length: count });
    }
    // Serve replay data only in the oscilloscope phase (921600 baud, sync reads).
    if (replay.baud !== 921600 || !this.overlapped.isNull()) return;
    if (!replay.data || replay.offset >= replay.data.length) {
      replay.offset = 0; // loop the capture
    }
    const available = replay.data.length - replay.offset;
    const chunk = Math.min(this.requested, available, 4096);
    if (chunk <= 0) return;
    try {
      const slice = replay.data.subarray(replay.offset, replay.offset + chunk);
      this.buffer.writeByteArray(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
      replay.offset += chunk;
      if (!this.countPointer.isNull()) this.countPointer.writeU32(chunk);
      retval.replace(1);
      report("read-replay", { length: chunk, offset: replay.offset });
    } catch (error) {
      report("replay-error", { message: String(error) });
    }
  },
});

const purgeComm = kernel32.getExportByName("PurgeComm");
Interceptor.attach(purgeComm, {
  onEnter(args) {
    if (args[0].toString() === replay.handle) {
      replay.offset = 0;
      report("purge", { operation: args[1].toUInt32() });
    }
  },
});

// The capture is delivered by the Python driver as a hex payload message.
rpc.exports.setReplayData = function (hexString) {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  replay.data = bytes;
  return replay.data.length;
};

report("ready", { architecture: Process.arch, pointerSize: Process.pointerSize });
