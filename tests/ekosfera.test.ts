import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeEkosferaFrame,
  EKOSFERA_RESPONSE_MARKER,
  encodeEkosferaRequest,
  encodeRateSet,
  EkosferaRpcId,
  EkosferaStreamParser,
  ekosferaChecksum,
} from "../src/lib/ekosfera.ts";

test("ping request matches the recovered 12-byte header", () => {
  const encoded = encodeEkosferaRequest({ address: 0xff, command: EkosferaRpcId.ping, sequence: 0, payload: new Uint8Array(0) });
  assert.deepEqual(encoded, Uint8Array.from([
    0x7b, 0xff, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x84, 0x00,
  ]));
  assert.deepEqual(decodeEkosferaFrame(encoded), {
    address: 0xff,
    command: 0,
    sequence: 0,
    payload: new Uint8Array(0),
  });
});

test("rateSet encodes 921600 baud with payload checksum", () => {
  const encoded = encodeRateSet(921600, 0xff, 1);
  assert.deepEqual(encoded, Uint8Array.from([
    0x7b, 0xff, 0x03, 0x00, 0x06, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x7a, 0x00,
    0x00, 0x10, 0x0e, 0x00, 0xf1, 0xef,
  ]));
  const decoded = decodeEkosferaFrame(encoded);
  assert.equal(decoded.command, 3);
  assert.deepEqual(decoded.payload, Uint8Array.from([0x00, 0x10, 0x0e, 0x00]));
});

test("response marker and command + 0x8000 decode correctly", () => {
  const response = encodeEkosferaRequest({ address: 0xff, command: EkosferaRpcId.rateSet, sequence: 7, payload: new Uint8Array([0, 0x10, 0x0e, 0]) });
  response[0] = EKOSFERA_RESPONSE_MARKER;
  new DataView(response.buffer).setUint16(2, EkosferaRpcId.rateSet + 0x8000, true);
  new DataView(response.buffer).setUint16(10, 0, true);
  // Recalculate after changing marker and command.
  new DataView(response.buffer).setUint16(10, ekosferaChecksum(response.subarray(0, 10)), true);
  const decoded = decodeEkosferaFrame(response);
  assert.equal(decoded.command, 0x8003);
  assert.equal(decoded.sequence, 7);
});

test("decoder rejects header, payload and size corruption", () => {
  const valid = encodeRateSet(921600);
  const badHeader = valid.slice();
  badHeader[1] ^= 1;
  assert.throws(() => decodeEkosferaFrame(badHeader), /заголовка/);
  const badPayload = valid.slice();
  badPayload[12] ^= 1;
  assert.throws(() => decodeEkosferaFrame(badPayload), /данных/);
  assert.throws(() => decodeEkosferaFrame(valid.slice(0, -1)), /Размер/);
  assert.throws(() => encodeEkosferaRequest({ address: 0xff, command: 0, sequence: 0, payload: new Uint8Array(1) }), /чётный/);
});

test("stream parser recovers response frames from partial and noisy reads", () => {
  const parser = new EkosferaStreamParser();
  const frames: unknown[] = [];
  parser.addEventListener("frame", (event) => frames.push((event as CustomEvent<unknown>).detail));
  const response = encodeRateSet(921600, 0xff, 9);
  response[0] = EKOSFERA_RESPONSE_MARKER;
  new DataView(response.buffer).setUint16(10, ekosferaChecksum(response.subarray(0, 10)), true);
  const noisy = new Uint8Array(3 + response.length);
  noisy.set([1, 2, 3], 0);
  noisy.set(response, 3);

  parser.push(noisy.subarray(0, 8));
  parser.push(noisy.subarray(8, 13));
  parser.push(noisy.subarray(13));

  assert.equal(frames.length, 1);
  assert.equal((frames[0] as { sequence: number }).sequence, 9);
});
