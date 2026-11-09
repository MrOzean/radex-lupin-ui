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

/** In-place iterative radix-2 FFT over interleaved real/imaginary values. */
function radix2Fft(values: Float64Array): void {
  const n = values.length / 2;
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

/** Arbitrary-length real FFT using Bluestein's chirp-z transform. */
export function realFft(input: Float64Array): Float64Array {
  const n = input.length;
  if (n < 2) throw new Error("FFT input is too short");
  const output = new Float64Array(n * 2);

  if ((n & (n - 1)) === 0) {
    for (let i = 0; i < n; i++) output[i * 2] = input[i];
    radix2Fft(output);
    return output;
  }

  const convolutionSize = 2 ** Math.ceil(Math.log2(n * 2 - 1));
  const a = new Float64Array(convolutionSize * 2);
  const b = new Float64Array(convolutionSize * 2);
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * ((i * i) % (2 * n))) / n;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    a[i * 2] = input[i] * cosine;
    a[i * 2 + 1] = -input[i] * sine;
    b[i * 2] = cosine;
    b[i * 2 + 1] = sine;
    if (i > 0) {
      b[(convolutionSize - i) * 2] = cosine;
      b[(convolutionSize - i) * 2 + 1] = sine;
    }
  }

  radix2Fft(a);
  radix2Fft(b);
  for (let i = 0; i < convolutionSize; i++) {
    const ar = a[i * 2];
    const ai = a[i * 2 + 1];
    const br = b[i * 2];
    const bi = b[i * 2 + 1];
    a[i * 2] = ar * br - ai * bi;
    a[i * 2 + 1] = ar * bi + ai * br;
  }

  // Inverse FFT by conjugation, forward transform and conjugation/scaling.
  for (let i = 1; i < a.length; i += 2) a[i] = -a[i];
  radix2Fft(a);
  for (let i = 0; i < a.length; i += 2) {
    a[i] /= convolutionSize;
    a[i + 1] = -a[i + 1] / convolutionSize;
  }

  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * ((i * i) % (2 * n))) / n;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const real = a[i * 2];
    const imaginary = a[i * 2 + 1];
    output[i * 2] = real * cosine + imaginary * sine;
    output[i * 2 + 1] = imaginary * cosine - real * sine;
  }
  return output;
}

/**
 * Normalized spectrum compatible with RadexLight's EsEapMath.normalizeAndExtremaFind.
 * Each FFT magnitude is normalized by the sum of all FFT magnitudes. Unlike a
 * peak-normalized display, the largest peak is not forced to 0 dB.
 */
export function powerSpectrum(
  samples: SampleArray,
  sampleRate: number,
  maxFrequency = sampleRate / 2,
): SpectrumBin[] {
  const count = samples.length;
  if (count < 4) return [];

  let sum = 0;
  for (let i = 0; i < count; i++) sum += samples[i];
  const mean = sum / count;
  const input = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (count - 1));
    input[i] = (samples[i] - mean) * window;
  }

  const transformed = realFft(input);
  const magnitudes = new Float64Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const magnitude = Math.hypot(transformed[i * 2], transformed[i * 2 + 1]);
    magnitudes[i] = magnitude;
    total += magnitude;
  }
  if (total === 0) return [];

  const bins: SpectrumBin[] = [];
  const maxBin = Math.min(count / 2, Math.ceil((maxFrequency * count) / sampleRate));
  for (let i = 1; i <= maxBin; i++) {
    const normalized = magnitudes[i] / total;
    bins.push({
      frequency: (i * sampleRate) / count,
      decibels: Math.max(-100, 20 * Math.log10(Math.max(normalized, 1e-5))),
    });
  }
  return bins;
}

export function dominantFrequencies(spectrum: readonly SpectrumBin[], count = 3): SpectrumBin[] {
  return spectrum
    .filter((bin, index) => {
      if (bin.decibels < -40) return false;
      const previous = spectrum[index - 1]?.decibels ?? -Infinity;
      const next = spectrum[index + 1]?.decibels ?? -Infinity;
      return bin.decibels >= previous && bin.decibels >= next;
    })
    .sort((a, b) => b.decibels - a.decibels)
    .slice(0, count);
}
