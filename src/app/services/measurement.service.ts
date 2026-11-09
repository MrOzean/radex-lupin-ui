import { computed, inject, Injectable, signal } from "@angular/core";
import { dominantFrequencies, powerSpectrum, signalStats, type SampleArray, type SignalStats, type SpectrumBin } from "../../lib/analysis";
import type { DemoChunk } from "../../lib/demo";
import { LowPassFilter } from "../../lib/filter";
import { downloadText, Recording } from "../../lib/recording";
import { DemoService } from "./demo.service";
import { SerialService } from "./serial.service";

@Injectable({ providedIn: "root" })
export class MeasurementService {
  readonly serial = inject(SerialService);
  readonly demo = inject(DemoService);
  private readonly recorder = new Recording();
  private readonly buffer = new Float32Array(2048);
  private sampleCount = 0;
  private lastRecorded = 0;
  private lowPass = new LowPassFilter(2000);

  readonly stats = signal<SignalStats>({ minimum: 0, maximum: 0, mean: 0, flickerPercent: 0 });
  readonly samples = signal<SampleArray>([]);
  readonly spectrum = signal<readonly SpectrumBin[]>([]);
  readonly sampleRate = signal(2000);
  readonly running = signal(false);
  readonly correction = signal(1);
  readonly filterEnabled = signal(true);
  readonly comment = signal("");
  readonly recordActive = signal(false);
  readonly recordCount = signal(0);
  readonly dominant = computed(() => dominantFrequencies(this.spectrum()));
  readonly connected = computed(() => this.serial.state() === "connected");
  readonly sourceName = computed(() => {
    if (this.connected()) return this.running() ? "RADEX LUPIN · live" : "RADEX LUPIN · пауза";
    return this.demo.running() ? "Виртуальный светильник" : "Источник остановлен";
  });
  readonly statusText = computed(() => {
    if (this.connected()) return this.running() ? "LUPIN · live" : "Пауза · порт открыт";
    return this.demo.running() ? "Демо-режим" : "Остановлено";
  });

  constructor() {
    this.demo.packets.subscribe((chunk) => this.processChunk(chunk));
    this.serial.packets.subscribe((chunk) => this.processChunk(chunk));
    this.demo.start();
    this.running.set(true);
  }

  async connect(): Promise<void> {
    await this.serial.connect();
    this.demo.stop();
    this.sampleRate.set(6000);
    this.lowPass = new LowPassFilter(6000);
    this.running.set(true);
  }

  async disconnect(): Promise<void> {
    await this.serial.disconnect();
    this.running.set(false);
  }

  togglePause(): void {
    if (this.connected()) {
      if (!this.running()) this.lowPass.reset();
      this.running.update((running) => !running);
      return;
    }
    if (this.demo.running()) {
      this.demo.stop();
      this.running.set(false);
    } else {
      this.demo.start();
      this.sampleRate.set(2000);
      this.running.set(true);
    }
  }

  setCorrection(value: number): void {
    if (Number.isFinite(value) && value > 0) this.correction.set(value);
  }

  setFilterEnabled(enabled: boolean): void {
    this.filterEnabled.set(enabled);
    this.lowPass.reset();
  }

  toggleRecording(): void {
    if (this.recorder.active) this.recorder.stop();
    else {
      this.recorder.start();
      this.lastRecorded = 0;
    }
    this.recordActive.set(this.recorder.active);
    this.recordCount.set(this.recorder.count);
  }

  exportCsv(): void {
    if (this.recorder.count === 0) return;
    const comment = this.comment().trim();
    const prefix = comment ? `# ${comment}\r\n` : "";
    downloadText(prefix + this.recorder.toCsv(), `lupin-${new Date().toISOString().replaceAll(":", "-")}.csv`);
  }

  private processChunk(chunk: DemoChunk): void {
    if (!this.running()) return;
    const corrected = this.correction() === 1
      ? chunk.samples
      : chunk.samples.map((value) => value * this.correction());
    const processed = this.filterEnabled() ? this.lowPass.process(corrected) : corrected;

    if (processed.length >= this.buffer.length) {
      this.buffer.set(processed.slice(-this.buffer.length));
      this.sampleCount = this.buffer.length;
    } else {
      this.buffer.copyWithin(0, processed.length);
      this.buffer.set(processed, this.buffer.length - processed.length);
      this.sampleCount = Math.min(this.buffer.length, this.sampleCount + processed.length);
    }

    const visible = this.buffer.slice(this.buffer.length - this.sampleCount);
    const analysisSamples = processed.length > this.buffer.length ? processed : visible;
    const stats = signalStats(analysisSamples);
    const spectrum = powerSpectrum(analysisSamples, chunk.sampleRate);
    const dominant = dominantFrequencies(spectrum);
    this.samples.set(visible);
    this.sampleRate.set(chunk.sampleRate);
    this.stats.set(stats);
    this.spectrum.set(spectrum);

    const now = Date.now();
    if (this.recorder.active && now - this.lastRecorded >= 250) {
      this.recorder.add({
        timestamp: chunk.timestamp.toISOString(),
        illuminanceLux: stats.mean,
        flickerPercent: stats.flickerPercent,
        dominantFrequencyHz: dominant[0]?.frequency ?? 0,
      });
      this.lastRecorded = now;
      this.recordCount.set(this.recorder.count);
    }
  }
}
