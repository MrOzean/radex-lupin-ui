import {
  encodeMeasurementFile,
  type DeviceMetadata,
  type MeasurementFileData,
  type MeasurementType,
} from "./measurement-file";

export interface MeasurementRow {
  timestamp: string;
  illuminanceLux: number;
  flickerPercent: number;
  dominantFrequencyHz: number;
}

export interface RecordingExportOptions {
  measurementType: MeasurementType;
  correction: number;
  filterEnabled: boolean;
  comment: string;
  endedAt?: Date;
}

export class Recording {
  private rows: MeasurementRow[] = [];
  private chunks: Float32Array[] = [];
  private activeRecording = false;
  private sessionStartedAt: Date | null = null;
  private source = "";
  private device: DeviceMetadata | null = null;
  private streamSampleRate = 0;
  private rawSampleCount = 0;

  get active(): boolean {
    return this.activeRecording;
  }

  get count(): number {
    return this.rows.length;
  }

  get sampleCount(): number {
    return this.rawSampleCount;
  }

  get sampleRate(): number {
    return this.streamSampleRate;
  }

  start(sampleRate: number, source: string, device: DeviceMetadata | null = null, startedAt = new Date()): void {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Некорректная частота дискретизации записи");
    this.rows = [];
    this.chunks = [];
    this.rawSampleCount = 0;
    this.streamSampleRate = sampleRate;
    this.source = source;
    this.device = device;
    this.sessionStartedAt = startedAt;
    this.activeRecording = true;
  }

  stop(): void {
    this.activeRecording = false;
  }

  clear(): void {
    this.rows = [];
    this.chunks = [];
    this.rawSampleCount = 0;
    this.sessionStartedAt = null;
    this.activeRecording = false;
  }

  add(row: MeasurementRow): void {
    if (this.active) this.rows.push(row);
  }

  addSamples(samples: Float32Array): void {
    if (!this.active || samples.length === 0) return;
    const copy = new Float32Array(samples);
    this.chunks.push(copy);
    this.rawSampleCount += copy.length;
  }

  toCsv(unit = "лк"): string {
    const valueColumn = unit === "лк" ? "illuminance_lux" : "luminance_cd_m2";
    const header = `timestamp;${valueColumn};flicker_percent;dominant_frequency_hz`;
    const lines = this.rows.map((row) =>
      [row.timestamp, row.illuminanceLux.toFixed(3), row.flickerPercent.toFixed(3), row.dominantFrequencyHz.toFixed(2)].join(";"),
    );
    return `\uFEFF${[header, ...lines].join("\r\n")}`;
  }

  toMeasurementFile(options: RecordingExportOptions): MeasurementFileData {
    if (!this.sessionStartedAt) throw new Error("Запись ещё не была начата");
    const samples = new Float32Array(this.rawSampleCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const endedAt = options.endedAt ?? new Date();
    return {
      header: {
        format: "lupin-light-lab",
        version: 1,
        encoding: "float32-le",
        createdAt: new Date().toISOString(),
        startedAt: this.sessionStartedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        sampleRate: this.streamSampleRate,
        sampleCount: samples.length,
        measurementType: options.measurementType,
        correction: options.correction,
        filterEnabled: options.filterEnabled,
        comment: options.comment.trim(),
        source: this.source,
        device: this.device,
      },
      samples,
    };
  }

  toBinary(options: RecordingExportOptions): ArrayBuffer {
    return encodeMeasurementFile(this.toMeasurementFile(options));
  }
}

export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  downloadBlob(text, filename, type);
}
