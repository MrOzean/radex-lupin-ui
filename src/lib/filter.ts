import type { SampleArray } from "./analysis";

/** Windowed-sinc low-pass FIR with continuous state across stream chunks. */
export class LowPassFilter {
  private readonly kernel: Float64Array;
  private history: Float64Array;
  private initialized = false;

  constructor(sampleRate: number, cutoff = 500, taps = 101) {
    if (taps % 2 === 0) taps++;
    if (cutoff <= 0 || cutoff >= sampleRate / 2) {
      throw new Error("Low-pass cutoff must be between zero and Nyquist");
    }
    this.kernel = new Float64Array(taps);
    this.history = new Float64Array(taps - 1);

    const center = (taps - 1) / 2;
    const normalizedCutoff = cutoff / sampleRate;
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const x = i - center;
      const sinc = x === 0 ? 2 * normalizedCutoff : Math.sin(2 * Math.PI * normalizedCutoff * x) / (Math.PI * x);
      const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
      this.kernel[i] = sinc * blackman;
      sum += this.kernel[i];
    }
    for (let i = 0; i < taps; i++) this.kernel[i] /= sum;
  }

  reset(): void {
    this.initialized = false;
    this.history.fill(0);
  }

  process(samples: SampleArray): Float32Array {
    if (samples.length === 0) return new Float32Array(0);
    if (!this.initialized) {
      this.history.fill(samples[0]);
      this.initialized = true;
    }

    const input = new Float64Array(this.history.length + samples.length);
    input.set(this.history);
    input.set(samples, this.history.length);
    const output = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      let value = 0;
      for (let j = 0; j < this.kernel.length; j++) {
        value += input[i + j] * this.kernel[j];
      }
      output[i] = value;
    }
    this.history = input.slice(samples.length);
    return output;
  }
}
