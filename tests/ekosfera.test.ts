import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeEkosferaFrame,
  EKOSFERA_RESPONSE_MARKER,
  encodeEkosferaRequest,
  encodeRateSet,
  EkosferaRpcId,
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
