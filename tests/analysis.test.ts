import assert from "node:assert/strict";
import test from "node:test";
import { dominantFrequencies, powerSpectrum, signalStats } from "../src/lib/analysis.ts";

test("flicker coefficient follows the ГОСТ (max − min) / (2·mean) formula", () => {
  // 100 Гц sine around 400 lx with ±10 % amplitude: min 360, max 440.
  const sampleRate = 6000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 400 + 40 * Math.sin((2 * Math.PI * 100 * i) / sampleRate);
  }
  const stats = signalStats(samples);
  assert.ok(Math.abs(stats.minimum - 360) < 0.5);
  assert.ok(Math.abs(stats.maximum - 440) < 0.5);
  // (440 − 360) / (2·400) = 10 %
  assert.ok(Math.abs(stats.flickerPercent - 10) < 0.2);
  assert.equal(signalStats([]).flickerPercent, 0);
});

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
