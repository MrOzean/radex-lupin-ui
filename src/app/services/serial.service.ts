import { Injectable, signal } from "@angular/core";
import { Subject } from "rxjs";
import type { DemoChunk } from "../../lib/demo";
import { LupinStreamParser } from "../../lib/lupin";
import {
  errorMessage,
  hexDump,
  SerialConnection,
  type SerialLogEntry,
  type SerialState,
} from "../../lib/serial";

@Injectable({ providedIn: "root" })
export class SerialService {
  private readonly connection = new SerialConnection();
  private readonly parser = new LupinStreamParser();
  private pendingLines: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = signal<SerialState>("disconnected");
  readonly logs = signal<readonly string[]>([]);
  readonly packets = new Subject<DemoChunk>();
  readonly supported = SerialConnection.supported();

  constructor() {
    this.connection.addEventListener("state", (event) => {
      this.state.set((event as CustomEvent<SerialState>).detail);
    });
    this.connection.addEventListener("data", (event) => {
      this.parser.push((event as CustomEvent<Uint8Array>).detail);
    });
    this.parser.addEventListener("packet", (event) => {
      this.packets.next((event as CustomEvent<DemoChunk>).detail);
    });
    this.connection.addEventListener("log", (event) => {
      const entry = (event as CustomEvent<SerialLogEntry>).detail;
      const content = typeof entry.data === "string" ? entry.data : hexDump(entry.data);
      const prefix = entry.direction === "rx" ? "RX" : entry.direction === "tx" ? "TX" : "··";
      this.pendingLines.push(`${entry.timestamp.toLocaleTimeString("ru-RU")} ${prefix}  ${content}`);
      if (this.flushTimer === null) this.flushTimer = setTimeout(() => this.flushLogs(), 150);
    });
  }

  async connect(): Promise<void> {
    this.parser.reset();
    await this.connection.connect();
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
    this.parser.reset();
  }

  async writeHex(text: string): Promise<void> {
    const bytes = text.trim().split(/[\s,]+/).filter(Boolean).map((part) => {
      if (!/^[0-9a-fA-F]{1,2}$/.test(part)) throw new Error(`Некорректный байт: ${part}`);
      return Number.parseInt(part, 16);
    });
    if (bytes.length > 0) await this.connection.write(new Uint8Array(bytes));
  }

  clearLogs(): void {
    this.pendingLines = [];
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.logs.set([]);
  }

  private flushLogs(): void {
    this.flushTimer = null;
    this.logs.set([...this.logs(), ...this.pendingLines].slice(-200));
    this.pendingLines = [];
  }
}
