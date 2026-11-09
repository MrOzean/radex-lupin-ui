export type SampleArray = readonly number[] | Float32Array;

export interface SignalStats {
  minimum: number;
  maximum: number;
  mean: number;
  flickerPercent: number;
}

export interface SpectrumBin {
  frequency: number;
  decibels: number;
}

export function signalStats(samples: SampleArray): SignalStats {
  if (samples.length === 0) {
    return { minimum: 0, maximum: 0, mean: 0, flickerPercent: 0 };
  }

  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  for (const sample of samples) {
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
    sum += sample;
  }
  const mean = sum / samples.length;
  const flickerPercent = mean === 0 ? 0 : ((maximum - minimum) / mean) * 100;
  return { minimum, maximum, mean, flickerPercent };
}

/** In-place iterative radix-2 FFT. Input contains interleaved real/imaginary values. */
export function fft(values: Float64Array): void {
  const n = values.length / 2;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error("FFT size must be a power of two");
  }

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      for (let k = 0; k < 2; k++) {
        const a = i * 2 + k;
        const b = j * 2 + k;
        [values[a], values[b]] = [values[b], values[a]];
      }
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const theta = angle * j;
        const wr = Math.cos(theta);
        const wi = Math.sin(theta);
        const even = (start + j) * 2;
        const odd = (start + j + half) * 2;
        const tr = wr * values[odd] - wi * values[odd + 1];
        const ti = wr * values[odd + 1] + wi * values[odd];
        values[odd] = values[even] - tr;
        values[odd + 1] = values[even + 1] - ti;
        values[even] += tr;
        values[even + 1] += ti;
      }
    }
  }
}

export function powerSpectrum(
  samples: SampleArray,
  sampleRate: number,
  maxFrequency = 500,
): SpectrumBin[] {
  const count = 2 ** Math.floor(Math.log2(Math.min(samples.length, 4096)));
  if (count < 4) return [];

  const start = samples.length - count;
  let sum = 0;
  for (let i = start; i < samples.length; i++) sum += samples[i];
  const mean = sum / count;
  const data = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    data[i * 2] = (samples[start + i] - mean) * window;
  }
  fft(data);

  const bins: SpectrumBin[] = [];
  const maxBin = Math.min(count / 2, Math.ceil((maxFrequency * count) / sampleRate));
  for (let i = 1; i <= maxBin; i++) {
    const real = data[i * 2];
    const imaginary = data[i * 2 + 1];
    const power = (real * real + imaginary * imaginary) / (count * count);
    bins.push({
      frequency: (i * sampleRate) / count,
      decibels: Math.max(-100, 10 * Math.log10(Math.max(power, 1e-10))),
    });
  }
  const peak = Math.max(...bins.map((bin) => bin.decibels), -100);
  return bins.map((bin) => ({ ...bin, decibels: Math.max(-100, bin.decibels - peak) }));
}

export function dominantFrequencies(spectrum: readonly SpectrumBin[], count = 3): SpectrumBin[] {
  return spectrum
    .filter((bin) => bin.decibels >= -40)
    .sort((a, b) => b.decibels - a.decibels)
    .slice(0, count);
}
