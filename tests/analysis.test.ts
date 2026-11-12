import assert from "node:assert/strict";
import test from "node:test";
import { dominantFrequencies, powerSpectrum } from "../src/lib/analysis.ts";

test("spectrum range limits computed bins without hiding the in-range peak", () => {
  const sampleRate = 6000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    samples[i] = 400 + 40 * Math.sin(2 * Math.PI * 100 * time) + 20 * Math.sin(2 * Math.PI * 1000 * time);
  }

  const full = powerSpectrum(samples, sampleRate);
  const limited = powerSpectrum(samples, sampleRate, 500);
  assert.ok(full.at(-1)!.frequency > 2999);
  assert.ok(limited.at(-1)!.frequency <= 500);
  assert.ok(dominantFrequencies(limited).some((bin) => bin.frequency === 100));
  assert.ok(!limited.some((bin) => bin.frequency === 1000));
});
