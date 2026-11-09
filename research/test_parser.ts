import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LUPIN_MARKER, LUPIN_PACKET_BYTES, LUPIN_SAMPLES_PER_PACKET, LupinStreamParser } from "../src/lib/lupin.ts";
import { signalStats } from "../src/lib/analysis.ts";

const capture = readFileSync(new URL("./passive-com5.bin", import.meta.url));
const parser = new LupinStreamParser();
const packets: Float32Array[] = [];
parser.addEventListener("packet", (event) => {
  packets.push((event as CustomEvent<{ samples: Float32Array }>).detail.samples);
});

for (let offset = 0; offset < capture.length;) {
  const size = [1, 7, 240, 13, 4096, 3, 1200][Math.floor(offset / 997) % 7];
  parser.push(capture.subarray(offset, Math.min(capture.length, offset + size)));
  offset += size;
}

assert.equal(packets.length, 4, "The capture contains four complete packets and two partial edge packets");
for (const packet of packets) assert.equal(packet.length, LUPIN_SAMPLES_PER_PACKET);
assert.ok(Math.abs(packets[0][0] - 2.791069984436035) < 1e-9);
const stats = signalStats(packets[0]);
assert.ok(stats.minimum > 2.7 && stats.maximum < 3);
assert.ok(stats.mean > 2.7 && stats.mean < 3);
assert.ok(stats.flickerPercent > 0 && stats.flickerPercent < 10);

const frame = new Uint8Array(LUPIN_PACKET_BYTES);
frame.set(LUPIN_MARKER);
const view = new DataView(frame.buffer);
view.setFloat32(LUPIN_MARKER.length + 12, 148389854.5, true);
parser.push(frame);
assert.equal(packets.length, 4, "Absurd float values must reject the whole frame");
frame.fill(0, LUPIN_MARKER.length);
view.setFloat32(LUPIN_MARKER.length, 125.25, true);
parser.push(frame);
assert.equal(packets.length, 5, "Parser must resynchronize on the next valid frame");
assert.equal(packets.at(-1)?.[0], 125.25);

console.log("Parser OK", {
  packets: packets.length,
  samples: packets[0].length,
  minimum: stats.minimum,
  maximum: stats.maximum,
  mean: stats.mean,
  flickerPercent: stats.flickerPercent,
});
