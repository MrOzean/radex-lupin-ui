import assert from "node:assert/strict";
import test from "node:test";
import { SerialConnection } from "../src/lib/serial.ts";

class FakeSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  closed = false;
  selectionRequests = 0;
  signalHistory: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = [];

  async open(): Promise<void> {
    this.closed = false;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => { this.controller = controller; },
    });
    this.writable = new WritableStream<Uint8Array>();
  }

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    this.signalHistory.push(signals);
  }
  async close(): Promise<void> { this.closed = true; }
}

function installFakeSerial(port: FakeSerialPort, t: { after: (callback: () => void) => void }): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serial: { requestPort: async () => { port.selectionRequests++; return port; } } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
}

test("unexpected stream failure resets the connection and allows reconnecting", async (t) => {
  const port = new FakeSerialPort();
  installFakeSerial(port, t);
  const connection = new SerialConnection();
  await connection.connect(9600);
  assert.equal(connection.state, "connected");

  const lost = new Promise<string>((resolve) => {
    connection.addEventListener("connectionloss", (event) => {
      resolve((event as CustomEvent<string>).detail);
    }, { once: true });
  });
  port.controller?.error(new Error("USB device removed"));
  assert.match(await lost, /USB device removed/);
  assert.equal(connection.state, "disconnected");

  await connection.connect(9600);
  assert.equal(connection.state, "connected");
  assert.equal(port.selectionRequests, 2);
  await connection.disconnect();
  assert.equal(connection.state, "disconnected");
});

test("native SerialPort disconnect event reports a visible connection loss", async (t) => {
  const port = new FakeSerialPort();
  installFakeSerial(port, t);
  const connection = new SerialConnection();
  await connection.connect(9600);

  const lost = new Promise<string>((resolve) => {
    connection.addEventListener("connectionloss", (event) => {
      resolve((event as CustomEvent<string>).detail);
    }, { once: true });
  });
  port.dispatchEvent(new Event("disconnect"));

  assert.match(await lost, /USB/);
  assert.equal(connection.state, "disconnected");
});

test("manual disconnect does not report an unexpected connection loss", async (t) => {
  const port = new FakeSerialPort();
  installFakeSerial(port, t);
  const connection = new SerialConnection();
  let unexpectedLoss = false;
  connection.addEventListener("connectionloss", () => { unexpectedLoss = true; });

  await connection.connect(9600);
  await connection.disconnect();

  assert.equal(unexpectedLoss, false);
  assert.equal(connection.state, "disconnected");
  assert.equal(port.closed, true);
  assert.deepEqual(port.signalHistory.at(-1), { dataTerminalReady: false, requestToSend: false });
  await connection.connect(9600);
  assert.equal(port.selectionRequests, 1);
  await connection.disconnect();
});
