import { computed, inject, Injectable, signal } from "@angular/core";
import { dominantFrequencies, powerSpectrum, signalStats, type SampleArray, type SignalStats, type SpectrumBin } from "../../lib/analysis";
import type { DemoChunk } from "../../lib/demo";
import { LowPassFilter } from "../../lib/filter";
import {
  decodeMeasurementFile,
  type MeasurementFileData,
  type MeasurementType,
} from "../../lib/measurement-file";
import { downloadBlob, downloadText, Recording } from "../../lib/recording";
import { DemoService } from "./demo.service";
import { SerialService } from "./serial.service";

export interface LoadedMeasurement extends MeasurementFileData {
  fileName: string;
}

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
  readonly measurementType = signal<MeasurementType>("illuminance");
  readonly unit = computed(() => this.measurementType() === "illuminance" ? "лк" : "кд/м²");
  readonly filterEnabled = signal(true);
  readonly comment = signal("");
  readonly recordActive = signal(false);
  readonly recordCount = signal(0);
  readonly recordSampleCount = signal(0);
  readonly recordSampleRate = signal(2000);
  readonly recordDuration = computed(() => this.recordSampleCount() / this.recordSampleRate());
  readonly archive = signal<LoadedMeasurement | null>(null);
  readonly playbackOffset = signal(0);
  readonly playbackWindowSize = signal(2000);
  readonly playbackDuration = computed(() => (this.archive()?.samples.length ?? 0) / this.sampleRate());
  readonly playbackPosition = computed(() => this.playbackOffset() / this.sampleRate());
  readonly playbackWindowSeconds = computed(() => this.playbackWindowSize() / this.sampleRate());
  readonly playbackMaxOffset = computed(() => Math.max(0, (this.archive()?.samples.length ?? 0) - this.playbackWindowSize()));
  readonly dominant = computed(() => dominantFrequencies(this.spectrum()));
  readonly connected = computed(() => this.serial.state() === "connected");
  readonly modeLabel = computed(() => this.archive() ? "FILE" : this.running() ? "LIVE" : "PAUSE");
  readonly sourceName = computed(() => {
    const archive = this.archive();
    if (archive) return `Архив · ${archive.fileName}`;
    if (this.connected()) return this.running() ? "RADEX LUPIN · live" : "RADEX LUPIN · пауза";
    return this.demo.running() ? "Виртуальный светильник" : "Источник остановлен";
  });
  readonly statusText = computed(() => {
    if (this.archive()) return "Архив · просмотр";
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
    this.stopRecording();
    if (this.archive()) this.resetSessionSettings();
    this.archive.set(null);
    this.playbackOffset.set(0);
    this.demo.stop();
    this.sampleRate.set(6000);
    this.lowPass = new LowPassFilter(6000);
    this.running.set(true);
  }

  async disconnect(): Promise<void> {
    this.stopRecording();
    await this.serial.disconnect();
    this.running.set(false);
  }

  togglePause(): void {
    if (this.archive()) return;
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
    if (Number.isFinite(value) && value > 0) {
      this.correction.set(value);
      this.renderPlayback();
    }
  }

  setMeasurementType(type: MeasurementType): void {
    this.measurementType.set(type);
  }

  setFilterEnabled(enabled: boolean): void {
    this.filterEnabled.set(enabled);
    this.lowPass.reset();
    this.renderPlayback();
  }

  toggleRecording(): void {
    if (this.archive()) return;
    if (this.recorder.active) {
      this.stopRecording();
      return;
    }

    const device = this.connected() ? { name: "RADEX LUPIN" } : { name: "Виртуальный светильник" };
    const source = this.connected() ? "RADEX LUPIN · Web Serial" : "Виртуальный светильник · demo";
    this.recorder.start(this.sampleRate(), source, device);
    this.lastRecorded = 0;
    this.recordActive.set(true);
    this.recordCount.set(0);
    this.recordSampleCount.set(0);
    this.recordSampleRate.set(this.sampleRate());
  }

  exportCsv(): void {
    if (this.archive() || this.recorder.count === 0) return;
    const comment = this.comment().trim();
    const prefix = comment ? `# ${comment}\r\n` : "";
    downloadText(prefix + this.recorder.toCsv(this.unit()), `lupin-${fileTimestamp()}.csv`);
  }

  exportMeasurement(): boolean {
    if (this.recorder.sampleCount === 0) return false;
    const binary = this.recorder.toBinary({
      measurementType: this.measurementType(),
      correction: this.correction(),
      filterEnabled: this.filterEnabled(),
      comment: this.comment(),
    });
    downloadBlob(binary, `lupin-${fileTimestamp()}.lupinlab`, "application/octet-stream");
    return true;
  }

  async loadFile(file: File): Promise<void> {
    const data = decodeMeasurementFile(await file.arrayBuffer());
    this.stopRecording();
    this.demo.stop();
    if (this.serial.state() !== "disconnected") await this.serial.disconnect();

    this.archive.set({ ...data, fileName: file.name });
    this.running.set(false);
    this.sampleRate.set(data.header.sampleRate);
    this.measurementType.set(data.header.measurementType);
    this.correction.set(data.header.correction);
    this.filterEnabled.set(data.header.filterEnabled);
    this.comment.set(data.header.comment);
    this.playbackWindowSize.set(Math.max(1, Math.round(data.header.sampleRate)));
    this.playbackOffset.set(0);
    this.lowPass = new LowPassFilter(data.header.sampleRate);
    this.renderPlayback();
  }

  closeFile(): void {
    if (!this.archive()) return;
    this.archive.set(null);
    this.playbackOffset.set(0);
    this.buffer.fill(0);
    this.sampleCount = 0;
    this.resetSessionSettings();
    if (this.connected()) {
      this.sampleRate.set(6000);
      this.lowPass = new LowPassFilter(6000);
      this.running.set(true);
    } else {
      this.sampleRate.set(2000);
      this.lowPass = new LowPassFilter(2000);
      this.demo.start();
      this.running.set(true);
    }
  }

  setPlaybackOffset(value: number): void {
    if (!this.archive() || !Number.isFinite(value)) return;
    const offset = Math.min(this.playbackMaxOffset(), Math.max(0, Math.round(value)));
    this.playbackOffset.set(offset);
    this.renderPlayback();
  }

  stepPlayback(direction: -1 | 1): void {
    this.setPlaybackOffset(this.playbackOffset() + direction * this.playbackWindowSize());
  }

  setPlaybackWindow(seconds: number): void {
    if (!this.archive() || !Number.isFinite(seconds) || seconds <= 0) return;
    this.playbackWindowSize.set(Math.max(4, Math.round(this.sampleRate() * seconds)));
    this.setPlaybackOffset(this.playbackOffset());
  }

  private processChunk(chunk: DemoChunk): void {
    if (!this.running() || this.archive()) return;
    if (this.recorder.active) {
      if (chunk.sampleRate !== this.recorder.sampleRate) {
        this.stopRecording();
      } else {
        this.recorder.addSamples(chunk.samples);
        this.recordSampleCount.set(this.recorder.sampleCount);
      }
    }

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

  private renderPlayback(): void {
    const archive = this.archive();
    if (!archive) return;
    const offset = Math.min(this.playbackOffset(), this.playbackMaxOffset());
    const end = Math.min(archive.samples.length, offset + this.playbackWindowSize());
    const raw = archive.samples.slice(offset, end);
    let processed = this.correction() === 1
      ? raw
      : raw.map((value) => value * this.correction());
    if (this.filterEnabled()) {
      const warmupOffset = Math.max(0, offset - 100);
      const filterInput = archive.samples.slice(warmupOffset, end);
      const correctedInput = this.correction() === 1
        ? filterInput
        : filterInput.map((value) => value * this.correction());
      const filtered = new LowPassFilter(this.sampleRate()).process(correctedInput);
      processed = filtered.slice(offset - warmupOffset);
    }
    const spectrum = powerSpectrum(processed, this.sampleRate());
    this.samples.set(processed);
    this.stats.set(signalStats(processed));
    this.spectrum.set(spectrum);
  }

  private stopRecording(): void {
    if (!this.recorder.active) return;
    this.recorder.stop();
    this.recordActive.set(false);
  }

  private resetSessionSettings(): void {
    this.correction.set(1);
    this.measurementType.set("illuminance");
    this.filterEnabled.set(true);
    this.comment.set("");
  }
}

function fileTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}
