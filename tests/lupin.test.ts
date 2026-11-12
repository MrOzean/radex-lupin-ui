import assert from "node:assert/strict";
import test from "node:test";
import {
  LUPIN_MARKER,
  LUPIN_PACKET_BYTES,
  LUPIN_SAMPLES_PER_PACKET,
  LupinStreamParser,
} from "../src/lib/lupin.ts";

function packet(value = 100): Uint8Array {
  const bytes = new Uint8Array(LUPIN_PACKET_BYTES);
  bytes.set(LUPIN_MARKER, 0);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < LUPIN_SAMPLES_PER_PACKET; i++) {
    view.setFloat32(LUPIN_MARKER.length + i * 4, value, true);
  }
  return bytes;
}

test("parser counts received packets across partial reads", () => {
  const parser = new LupinStreamParser();
  const packets: Float32Array[] = [];
  parser.addEventListener("packet", (event) => {
    packets.push((event as CustomEvent<{ samples: Float32Array }>).detail.samples);
  });
  const bytes = packet(147.5);

  parser.push(bytes.subarray(0, 17));
  parser.push(bytes.subarray(17, 501));
  parser.push(bytes.subarray(501));

  assert.equal(packets.length, 1);
  assert.equal(packets[0][0], 147.5);
  assert.equal(packets[0].length, LUPIN_SAMPLES_PER_PACKET);
  assert.deepEqual(parser.diagnostics, {
    bytesReceived: bytes.length,
    packetsReceived: 1,
    discardedBytes: 0,
    invalidPackets: 0,
    resyncEvents: 0,
  });
});

test("parser reports garbage before a valid marker", () => {
  const parser = new LupinStreamParser();
  const bytes = packet();
  parser.push(new Uint8Array([1, 2, 3, 4, 5]));
  parser.push(bytes);

  const diagnostics = parser.diagnostics;
  assert.equal(diagnostics.packetsReceived, 1);
  assert.equal(diagnostics.discardedBytes, 5);
  assert.equal(diagnostics.resyncEvents, 1);
  assert.equal(diagnostics.bytesReceived, bytes.length + 5);
});

test("parser counts an invalid packet and recovers at the next marker", () => {
  const parser = new LupinStreamParser();
  let received = 0;
  parser.addEventListener("packet", () => received++);
  const invalid = packet();
  new DataView(invalid.buffer).setFloat32(LUPIN_MARKER.length, Number.NaN, true);
  parser.push(invalid);
  parser.push(packet(250));

  assert.equal(received, 1);
  assert.equal(parser.diagnostics.invalidPackets, 1);
  assert.equal(parser.diagnostics.packetsReceived, 1);
  assert.ok(parser.diagnostics.discardedBytes >= 1);
  assert.ok(parser.diagnostics.resyncEvents >= 1);
});

test("reset can preserve or clear diagnostics", () => {
  const parser = new LupinStreamParser();
  parser.push(packet());
  parser.reset();
  assert.equal(parser.diagnostics.packetsReceived, 1);
  parser.reset(true);
  assert.equal(parser.diagnostics.packetsReceived, 0);
  assert.equal(parser.diagnostics.bytesReceived, 0);
});
