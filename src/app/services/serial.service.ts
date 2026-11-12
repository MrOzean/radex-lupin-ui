import { Injectable, signal } from "@angular/core";
import { Subject } from "rxjs";
import type { DemoChunk } from "../../lib/demo";
import {
  EkosferaRpcId,
  EkosferaStreamParser,
  encodeEkosferaRequest,
  type EkosferaFrame,
} from "../../lib/ekosfera";
import { LupinStreamParser, type LupinStreamDiagnostics } from "../../lib/lupin";
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
  private readonly rpcParser = new EkosferaStreamParser();
  private rpcSequence = 0;
  private pendingLines: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  readonly state = signal<SerialState>("disconnected");
  readonly logs = signal<readonly string[]>([]);
  readonly diagnostics = signal<LupinStreamDiagnostics>({
    bytesReceived: 0,
    packetsReceived: 0,
    discardedBytes: 0,
    invalidPackets: 0,
    resyncEvents: 0,
  });
  readonly packets = new Subject<DemoChunk>();
  readonly rpcResponses = new Subject<EkosferaFrame>();
  readonly connectionLoss = new Subject<string>();
  readonly supported = SerialConnection.supported();

  constructor() {
    this.connection.addEventListener("state", (event) => {
      this.state.set((event as CustomEvent<SerialState>).detail);
    });
    this.connection.addEventListener("connectionloss", (event) => {
      this.connectionLoss.next((event as CustomEvent<string>).detail);
    });
    this.connection.addEventListener("data", (event) => {
      const bytes = (event as CustomEvent<Uint8Array>).detail;
      this.parser.push(bytes);
      this.rpcParser.push(bytes);
      this.diagnostics.set(this.parser.diagnostics);
    });
    this.parser.addEventListener("packet", (event) => {
      this.packets.next((event as CustomEvent<DemoChunk>).detail);
    });
    this.rpcParser.addEventListener("frame", (event) => {
      const frame = (event as CustomEvent<EkosferaFrame>).detail;
      this.rpcResponses.next(frame);
      this.queueLog(`RPC RX command=0x${frame.command.toString(16).toUpperCase()} seq=${frame.sequence} payload=${hexDump(frame.payload)}`);
    });
    this.connection.addEventListener("log", (event) => {
      const entry = (event as CustomEvent<SerialLogEntry>).detail;
      const content = typeof entry.data === "string" ? entry.data : hexDump(entry.data);
      const prefix = entry.direction === "rx" ? "RX" : entry.direction === "tx" ? "TX" : "··";
      this.queueLog(`${prefix}  ${content}`, entry.timestamp);
    });
  }

  async connect(baudRate = 921600): Promise<void> {
    this.parser.reset(true);
    this.rpcParser.reset();
    this.rpcSequence = 0;
    this.diagnostics.set(this.parser.diagnostics);
    await this.connection.connect(baudRate);
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
    this.parser.reset();
    this.rpcParser.reset();
  }

  async ping(address = 0xff): Promise<EkosferaFrame> {
    if (this.state() !== "connected") throw new Error("Порт не открыт");
    const sequence = this.rpcSequence;
    this.rpcSequence = (this.rpcSequence + 1) & 0xffff;
    const request = encodeEkosferaRequest({
      address,
      command: EkosferaRpcId.ping,
      sequence,
      payload: new Uint8Array(0),
    });

    return new Promise<EkosferaFrame>((resolve, reject) => {
      const subscription = this.rpcResponses.subscribe((frame) => {
        if (frame.sequence !== sequence) return;
        if (frame.command >= 0xfeff) {
          cleanup();
          reject(new Error(`Прибор вернул ошибку RPC 0x${frame.command.toString(16).toUpperCase()}`));
        } else if (frame.command === EkosferaRpcId.ping + 0x8000) {
          cleanup();
          resolve(frame);
        }
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Тайм-аут RPC ping: ответ не получен за 2 секунды"));
      }, 2000);
      const cleanup = (): void => {
        clearTimeout(timer);
        subscription.unsubscribe();
      };
      this.connection.write(request).catch((error: unknown) => {
        cleanup();
        reject(error);
      });
    });
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

  private queueLog(content: string, timestamp = new Date()): void {
    this.pendingLines.push(`${timestamp.toLocaleTimeString("ru-RU")} ${content}`);
    if (this.flushTimer === null) this.flushTimer = setTimeout(() => this.flushLogs(), 150);
  }

  private flushLogs(): void {
    this.flushTimer = null;
    this.logs.set([...this.logs(), ...this.pendingLines].slice(-200));
    this.pendingLines = [];
  }
}
