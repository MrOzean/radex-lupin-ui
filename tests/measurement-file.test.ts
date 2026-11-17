import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeMeasurementFile,
  encodeMeasurementFile,
  type MeasurementFileHeader,
} from "../src/lib/measurement-file.ts";

function header(sampleCount: number): MeasurementFileHeader {
  return {
    format: "lupin-light-lab",
    version: 1,
    encoding: "float32-le",
    createdAt: "2026-11-12T08:00:00.000Z",
    startedAt: "2026-11-12T07:59:00.000Z",
    endedAt: "2026-11-12T08:00:00.000Z",
    sampleRate: 6000,
    sampleCount,
    measurementType: "illuminance",
    lightingProfileId: "office",
    spectrumMaxFrequency: 1000,
    correction: 1.25,
    luminanceDivisor: 3.4,
    filterEnabled: true,
    comment: "Рабочее место у окна",
    source: "RADEX LUPIN · Web Serial",
    device: { name: "RADEX LUPIN", serialNumber: "TEST-01", firmware: "1.0" },
  };
}

test("round-trip preserves float32 samples and all metadata", () => {
  const samples = Float32Array.from([0, 1.25, 147.5, 200000, 0.0001, Math.PI]);
  const original = { header: header(samples.length), samples };
  const binary = encodeMeasurementFile(original);
  const decoded = decodeMeasurementFile(binary);

  assert.deepEqual(decoded.header, original.header);
  assert.deepEqual(decoded.samples, samples);
  assert.equal(binary.byteLength, 12 + new TextEncoder().encode(JSON.stringify(original.header)).length + samples.byteLength);
});

test("decoder accepts a bounded Uint8Array view", () => {
  const samples = Float32Array.from([10, 20, 30, 40]);
  const binary = encodeMeasurementFile({ header: header(samples.length), samples });
  const padded = new Uint8Array(binary.byteLength + 14);
  padded.set(new Uint8Array(binary), 7);
  const decoded = decodeMeasurementFile(padded.subarray(7, 7 + binary.byteLength));

  assert.deepEqual(decoded.samples, samples);
});

test("decoder rejects unknown magic and truncated sample payload", () => {
  const samples = new Float32Array(100);
  const binary = encodeMeasurementFile({ header: header(samples.length), samples });
  const wrongMagic = new Uint8Array(binary.slice(0));
  wrongMagic[0] = 0;

  assert.throws(() => decodeMeasurementFile(wrongMagic), /Неизвестный формат/);
  assert.throws(() => decodeMeasurementFile(binary.slice(0, binary.byteLength - 4)), /Размер данных/);
});

test("encoder rejects inconsistent sample count", () => {
  assert.throws(
    () => encodeMeasurementFile({ header: header(2), samples: new Float32Array(1) }),
    /Количество отсчётов/,
  );
});

test("decoder rejects a non-positive luminance divisor", () => {
  const samples = new Float32Array(4);
  const badHeader = JSON.stringify({ ...header(samples.length), luminanceDivisor: 0 });
  const headerBytes = new TextEncoder().encode(badHeader);
  const binary = new Uint8Array(12 + headerBytes.length + samples.byteLength);
  binary.set(new TextEncoder().encode("LUPINLAB"), 0);
  new DataView(binary.buffer).setUint32(8, headerBytes.length, true);
  binary.set(headerBytes, 12);
  binary.set(new Uint8Array(samples.buffer), 12 + headerBytes.length);
  assert.throws(() => decodeMeasurementFile(binary), /яркости/);
});
