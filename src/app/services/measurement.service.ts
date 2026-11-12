import { computed, inject, Injectable, OnDestroy, signal } from "@angular/core";
import { dominantFrequencies, powerSpectrum, signalStats, type SampleArray, type SignalStats, type SpectrumBin } from "../../lib/analysis";
import type { DemoChunk } from "../../lib/demo";
import { LowPassFilter } from "../../lib/filter";
import {
  assessFlicker,
  assessIlluminance,
  DEFAULT_LIGHTING_PROFILE_ID,
  LIGHTING_PROFILES,
  lightingProfileById,
} from "../../lib/lighting";
import {
  decodeMeasurementFile,
  type MeasurementFileData,
  type MeasurementType,
} from "../../lib/measurement-file";
import { downloadBlob, downloadText, Recording, samplesToCsv } from "../../lib/recording";
import { DemoService } from "./demo.service";
import { SerialService } from "./serial.service";

export interface LoadedMeasurement extends MeasurementFileData {
  fileName: string;
}

export type StreamState = "live" | "waiting" | "stalled" | "paused" | "archive" | "idle";

@Injectable({ providedIn: "root" })
export class MeasurementService implements OnDestroy {
  readonly serial = inject(SerialService);
  readonly demo = inject(DemoService);
  private readonly recorder = new Recording();
  private buffer = new Float32Array(2000);
  private sampleCount = 0;
  private lastRecorded = 0;
  private lowPass = new LowPassFilter(2000);
  private readonly streamClock = signal(Date.now());
  private readonly streamTimer = setInterval(() => this.streamClock.set(Date.now()), 500);

  readonly stats = signal<SignalStats>({ minimum: 0, maximum: 0, mean: 0, flickerPercent: 0 });
  readonly samples = signal<SampleArray>([]);
  readonly spectrum = signal<readonly SpectrumBin[]>([]);
  readonly sampleRate = signal(2000);
  readonly running = signal(false);
  readonly correction = signal(1);
  readonly measurementType = signal<MeasurementType>("illuminance");
  readonly lightingProfiles = LIGHTING_PROFILES;
  readonly lightingProfileId = signal(DEFAULT_LIGHTING_PROFILE_ID);
  readonly lightingProfile = computed(() => lightingProfileById(this.lightingProfileId()));
  readonly levelMinimum = computed(() => this.measurementType() === "luminance" ? 50 : this.lightingProfile().minimumLux);
  readonly levelMaximum = computed(() => this.measurementType() === "luminance" ? 1000 : this.lightingProfile().greenMaximumLux);
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
  readonly lastPacketAt = signal<number | null>(null);
  readonly connectionIssue = signal<string | null>(null);
  readonly dominant = computed(() => dominantFrequencies(this.spectrum()));
  readonly connected = computed(() => this.serial.state() === "connected");
  readonly streamState = computed<StreamState>(() => {
    this.streamClock();
    if (this.archive()) return "archive";
    if (!this.connected() && !this.demo.running()) return "idle";
    if (!this.running()) return "paused";
    const lastPacket = this.lastPacketAt();
    if (lastPacket === null) return "waiting";
    return Date.now() - lastPacket > 2000 ? "stalled" : "live";
  });
  readonly streamAlert = computed(() => {
    const issue = this.connectionIssue();
    if (issue) return `LUPIN отключён: ${issue}`;
    if (this.streamState() === "stalled") return "Поток данных остановился. Проверьте USB-подключение или переподключите прибор.";
    return null;
  });
  readonly streamStatusText = computed(() => {
    const state = this.streamState();
    if (state === "live") return "Пакеты принимаются";
    if (state === "waiting") return "Ожидание первого пакета";
    if (state === "stalled") {
      const lastPacket = this.lastPacketAt();
      const seconds = lastPacket === null ? 0 : (this.streamClock() - lastPacket) / 1000;
      return `Нет пакетов ${seconds.toFixed(1)} с`;
    }
    if (state === "paused") return "Поток на паузе";
    if (state === "archive") return "Архивный сигнал";
    return "Источник остановлен";
  });
  readonly levelAssessment = computed(() => {
    const value = this.stats().mean;
    if (this.samples().length === 0 || this.stats().maximum <= 0) {
      return { tone: "idle", text: "Нет сигнала" };
    }
    // Luminance limits are a visual approximation; illuminance uses the selected normative guide.
    const luminance = this.measurementType() === "luminance";
    const assessment = luminance
      ? value < 50
        ? { tone: "warning" as const, text: "Ниже 50 кд/м²" }
        : value > 1000
          ? { tone: "warning" as const, text: "Выше 1000 кд/м²" }
          : { tone: "good" as const, text: "Зелёная зона · 50–1000 кд/м²" }
      : assessIlluminance(value, this.lightingProfile());
    return assessment;
  });
  readonly flickerAssessment = computed(() => {
    const flicker = this.stats().flickerPercent;
    if (this.samples().length === 0 || this.stats().maximum <= 0) {
      return { tone: "idle", text: "Нет сигнала" };
    }
    return assessFlicker(flicker, this.lightingProfile());
  });
  readonly modeLabel = computed(() => this.archive() ? "FILE" : this.running() ? "LIVE" : "PAUSE");
  readonly sourceName = computed(() => {
    const archive = this.archive();
    if (archive) return `Архив · ${archive.fileName}`;
    if (this.connected()) return this.running() ? "RADEX LUPIN · live" : "RADEX LUPIN · пауза";
    return this.demo.running() ? "Виртуальный светильник" : "Источник остановлен";
  });
  readonly statusText = computed(() => {
    const state = this.streamState();
    if (state === "archive") return "Архив · просмотр";
    if (state === "waiting") return this.connected() ? "LUPIN · ожидание данных" : "Демо · запуск";
    if (state === "stalled") return this.connected() ? "LUPIN · нет пакетов" : "Демо · нет данных";
    if (state === "paused") return this.connected() ? "Пауза · порт открыт" : "Пауза";
    if (state === "live") return this.connected() ? "LUPIN · live" : "Демо-режим";
    return "Остановлено";
  });

  constructor() {
    this.demo.packets.subscribe((chunk) => this.processChunk(chunk));
    this.serial.packets.subscribe((chunk) => this.processChunk(chunk));
    this.serial.connectionLoss.subscribe((reason) => {
      this.connectionIssue.set(reason);
      this.stopRecording();
      this.running.set(false);
      this.lastPacketAt.set(null);
    });
    this.demo.start();
    this.running.set(true);
  }

  async connect(): Promise<void> {
    await this.serial.connect();
    this.connectionIssue.set(null);
    this.stopRecording();
    if (this.archive()) this.resetSessionSettings();
    this.archive.set(null);
    this.playbackOffset.set(0);
    this.lastPacketAt.set(null);
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

  dismissConnectionIssue(): void {
    this.connectionIssue.set(null);
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

  setLightingProfile(id: string): void {
    this.lightingProfileId.set(lightingProfileById(id).id);
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
    const archive = this.archive();
    const comment = this.comment().trim();
    const prefix = comment ? `# ${comment}\r\n` : "";
    if (archive) {
      if (this.samples().length === 0) return;
      const csv = samplesToCsv({
        samples: this.samples(),
        sampleRate: this.sampleRate(),
        startedAt: archive.header.startedAt,
        sampleOffset: this.playbackOffset(),
        unit: this.unit(),
      });
      const baseName = archive.fileName.replace(/\.lupinlab$/i, "");
      downloadText(prefix + csv, `${baseName}-window-${this.playbackPosition().toFixed(3)}s.csv`);
      return;
    }
    if (this.recorder.count === 0) return;
    downloadText(prefix + this.recorder.toCsv(this.unit()), `lupin-${fileTimestamp()}.csv`);
  }

  exportMeasurement(): boolean {
    if (this.recorder.sampleCount === 0) return false;
    const binary = this.recorder.toBinary({
      measurementType: this.measurementType(),
      lightingProfileId: this.lightingProfileId(),
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
    this.lastPacketAt.set(null);
    this.running.set(false);
    this.sampleRate.set(data.header.sampleRate);
    this.measurementType.set(data.header.measurementType);
    this.setLightingProfile(data.header.lightingProfileId ?? DEFAULT_LIGHTING_PROFILE_ID);
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
    this.lastPacketAt.set(null);
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

  ngOnDestroy(): void {
    clearInterval(this.streamTimer);
  }

  private processChunk(chunk: DemoChunk): void {
    if (!this.running() || this.archive()) return;
    this.lastPacketAt.set(Date.now());
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

    if (this.buffer.length !== chunk.sampleRate) {
      this.buffer = new Float32Array(chunk.sampleRate);
      this.sampleCount = 0;
    }
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
    this.lightingProfileId.set(DEFAULT_LIGHTING_PROFILE_ID);
    this.filterEnabled.set(true);
    this.comment.set("");
  }
}

function fileTimestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}
