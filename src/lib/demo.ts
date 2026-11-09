export interface DemoChunk {
  samples: Float32Array;
  sampleRate: number;
  timestamp: Date;
}

export class DemoSource extends EventTarget {
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase = 0;
  readonly sampleRate = 2000;

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.emit(), 50);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const count = 100;
    const samples = new Float32Array(count);
    const base = 412 + Math.sin(this.phase * 0.0007) * 18;
    for (let i = 0; i < count; i++) {
      const time = this.phase / this.sampleRate;
      const modulation =
        Math.sin(2 * Math.PI * 100 * time) * 0.115 +
        Math.sin(2 * Math.PI * 50 * time + 0.7) * 0.025 +
        Math.sin(2 * Math.PI * 300 * time + 1.3) * 0.012;
      const noise = (Math.random() - 0.5) * 0.7;
      samples[i] = Math.max(0, base * (1 + modulation) + noise);
      this.phase++;
    }
    this.dispatchEvent(
      new CustomEvent<DemoChunk>("data", {
        detail: { samples, sampleRate: this.sampleRate, timestamp: new Date() },
      }),
    );
  }
}
