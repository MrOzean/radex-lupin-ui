import assert from "node:assert/strict";
import { dominantFrequencies, powerSpectrum, realFft } from "../src/lib/analysis.ts";

for (const size of [5, 12, 16]) {
  const input = Float64Array.from({ length: size }, (_, i) => Math.sin(i * 0.31) + i * 0.01);
  const actual = realFft(input);
  for (let k = 0; k < size; k++) {
    let real = 0;
    let imaginary = 0;
    for (let n = 0; n < size; n++) {
      const angle = (-2 * Math.PI * n * k) / size;
      real += input[n] * Math.cos(angle);
      imaginary += input[n] * Math.sin(angle);
    }
    assert.ok(Math.abs(actual[k * 2] - real) < 1e-8, `Real mismatch at N=${size}, k=${k}`);
    assert.ok(Math.abs(actual[k * 2 + 1] - imaginary) < 1e-8, `Imaginary mismatch at N=${size}, k=${k}`);
  }
}

const sampleRate = 6000;
const samples = Float64Array.from(
  { length: 6000 },
  (_, i) => 100 + 2 * Math.sin((2 * Math.PI * 100 * i) / sampleRate),
);
const spectrum = powerSpectrum(samples, sampleRate);
assert.equal(spectrum.length, 3000);
const dominant = dominantFrequencies(spectrum);
assert.equal(dominant[0].frequency, 100);
assert.ok(dominant[0].decibels < 0, "The spectrum must not be normalized to a 0 dB peak");
console.log("FFT OK", { dominant: dominant[0], bins: spectrum.length });
