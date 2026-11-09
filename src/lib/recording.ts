export interface MeasurementRow {
  timestamp: string;
  illuminanceLux: number;
  flickerPercent: number;
  dominantFrequencyHz: number;
}

export class Recording {
  private rows: MeasurementRow[] = [];
  private startedAt: Date | null = null;

  get active(): boolean {
    return this.startedAt !== null;
  }

  get count(): number {
    return this.rows.length;
  }

  start(): void {
    this.rows = [];
    this.startedAt = new Date();
  }

  stop(): void {
    this.startedAt = null;
  }

  clear(): void {
    this.rows = [];
    this.startedAt = null;
  }

  add(row: MeasurementRow): void {
    if (this.active) this.rows.push(row);
  }

  toCsv(): string {
    const header = "timestamp;illuminance_lux;flicker_percent;dominant_frequency_hz";
    const lines = this.rows.map((row) =>
      [row.timestamp, row.illuminanceLux.toFixed(3), row.flickerPercent.toFixed(3), row.dominantFrequencyHz.toFixed(2)].join(";"),
    );
    return `\uFEFF${[header, ...lines].join("\r\n")}`;
  }
}

export function downloadText(text: string, filename: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
