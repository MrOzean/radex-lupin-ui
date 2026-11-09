export const LUPIN_USB = { usbVendorId: 0xabba, usbProductId: 0xe011 } as const;

export interface SerialLogEntry {
  direction: "rx" | "tx" | "system";
  timestamp: Date;
  data: Uint8Array | string;
}

export type SerialState = "disconnected" | "connecting" | "connected";

export class SerialConnection extends EventTarget {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private closing = false;
  state: SerialState = "disconnected";

  static supported(): boolean {
    return "serial" in navigator;
  }

  async connect(baudRate = 921600): Promise<void> {
    if (this.port) return;
    if (!SerialConnection.supported()) {
      throw new Error("Web Serial API не поддерживается этим браузером");
    }

    this.state = "connecting";
    this.emitState();
    try {
      this.port = await navigator.serial.requestPort({ filters: [LUPIN_USB] });
      await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
      try {
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await this.port.setSignals({ dataTerminalReady: true, requestToSend: false });
      } catch (error) {
        this.log("system", `Не удалось установить DTR/RTS: ${errorMessage(error)}`);
      }
      this.writer = this.port.writable?.getWriter() ?? null;
      this.closing = false;
      this.state = "connected";
      this.log("system", `Порт открыт: ${baudRate} бод, 8N1`);
      this.readTask = this.readLoop();
      this.emitState();
    } catch (error) {
      this.port = null;
      this.writer = null;
      this.state = "disconnected";
      this.emitState();
      throw error;
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) return;
    this.reader = this.port.readable.getReader();
    try {
      while (!this.closing) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.length) {
          this.log("rx", value);
          this.dispatchEvent(new CustomEvent("data", { detail: value }));
        }
      }
    } catch (error) {
      if (!this.closing) this.log("system", `Ошибка чтения: ${errorMessage(error)}`);
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error("Порт не открыт");
    await this.writer.write(data);
    this.log("tx", data);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    await this.reader?.cancel();
    this.reader?.releaseLock();
    this.reader = null;
    if (this.readTask) await this.readTask;
    this.writer?.releaseLock();
    this.writer = null;
    try {
      await this.port?.close();
    } finally {
      this.port = null;
      this.state = "disconnected";
      this.log("system", "Порт закрыт");
      this.emitState();
    }
  }

  private log(direction: SerialLogEntry["direction"], data: Uint8Array | string): void {
    const entry: SerialLogEntry = { direction, data, timestamp: new Date() };
    this.dispatchEvent(new CustomEvent("log", { detail: entry }));
  }

  private emitState(): void {
    this.dispatchEvent(new CustomEvent("state", { detail: this.state }));
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hexDump(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}
