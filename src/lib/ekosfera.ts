export const EKOSFERA_REQUEST_MARKER = 0x7b;
export const EKOSFERA_RESPONSE_MARKER = 0x7a;
export const EKOSFERA_HEADER_BYTES = 12;

export const EkosferaRpcId = {
  ping: 0,
  changeAddress: 1,
  currentRateGet: 2,
  rateSet: 3,
  getImplementedRPCs: 4,
  getHealthInfo: 5,
  factoryReset: 6,
  queueHealthCheck: 7,
  shutdown: 8,
  queueBootloader: 9,
} as const;

export interface EkosferaFrame {
  address: number;
  command: number;
  sequence: number;
  payload: Uint8Array;
}

/** 16-bit one's-complement checksum over little-endian words. */
export function ekosferaChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < data.length; i += 2) sum += data[i] | (data[i + 1] << 8);
  if (data.length % 2 !== 0) sum += data[data.length - 1];
  while ((sum >>> 16) !== 0) sum = (sum & 0xffff) + (sum >>> 16);
  return (~sum) & 0xffff;
}

export function encodeEkosferaRequest(frame: EkosferaFrame): Uint8Array {
  if (frame.payload.length % 2 !== 0) throw new Error("Payload Ekosfera должен иметь чётный размер");
  if (frame.payload.length > 500) throw new Error("Payload Ekosfera слишком большой");
  const dataSize = frame.payload.length === 0 ? 0 : frame.payload.length + 2;
  const output = new Uint8Array(EKOSFERA_HEADER_BYTES + dataSize);
  const view = new DataView(output.buffer);
  output[0] = EKOSFERA_REQUEST_MARKER;
  output[1] = frame.address;
  view.setUint16(2, frame.command, true);
  view.setUint16(4, dataSize, true);
  view.setUint16(6, frame.sequence, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, ekosferaChecksum(output.subarray(0, 10)), true);
  if (dataSize > 0) {
    output.set(frame.payload, EKOSFERA_HEADER_BYTES);
    view.setUint16(EKOSFERA_HEADER_BYTES + frame.payload.length, ekosferaChecksum(frame.payload), true);
  }
  return output;
}

export function decodeEkosferaFrame(input: Uint8Array): EkosferaFrame {
  if (input.length < EKOSFERA_HEADER_BYTES) throw new Error("Кадр Ekosfera слишком короткий");
  if (input[0] !== EKOSFERA_REQUEST_MARKER && input[0] !== EKOSFERA_RESPONSE_MARKER) {
    throw new Error("Неизвестный маркер кадра Ekosfera");
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const dataSize = view.getUint16(4, true);
  if (dataSize === 1 || dataSize % 2 !== 0) throw new Error("Некорректное выравнивание данных Ekosfera");
  if (input.length !== EKOSFERA_HEADER_BYTES + dataSize) throw new Error("Размер кадра Ekosfera не совпадает с заголовком");
  if (view.getUint16(10, true) !== ekosferaChecksum(input.subarray(0, 10))) {
    throw new Error("Ошибка контрольной суммы заголовка Ekosfera");
  }
  if (dataSize > 0 && ekosferaChecksum(input.subarray(EKOSFERA_HEADER_BYTES)) !== 0) {
    throw new Error("Ошибка контрольной суммы данных Ekosfera");
  }
  return {
    address: input[1],
    command: view.getUint16(2, true),
    sequence: view.getUint16(6, true),
    payload: input.slice(EKOSFERA_HEADER_BYTES, input.length - (dataSize > 0 ? 2 : 0)),
  };
}

export class EkosferaStreamParser extends EventTarget {
  private buffer = new Uint8Array(0);

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;

    while (this.buffer.length > 0) {
      const marker = this.buffer.indexOf(EKOSFERA_RESPONSE_MARKER);
      if (marker < 0) {
        this.buffer = new Uint8Array(0);
        return;
      }
      if (marker > 0) this.buffer = this.buffer.slice(marker);
      if (this.buffer.length < 6) return;
      const dataSize = this.buffer[4] | (this.buffer[5] << 8);
      if (dataSize === 1 || dataSize % 2 !== 0 || dataSize > 502) {
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const frameSize = EKOSFERA_HEADER_BYTES + dataSize;
      if (this.buffer.length < frameSize) return;
      try {
        const frame = decodeEkosferaFrame(this.buffer.subarray(0, frameSize));
        this.buffer = this.buffer.slice(frameSize);
        this.dispatchEvent(new CustomEvent<EkosferaFrame>("frame", { detail: frame }));
      } catch {
        this.buffer = this.buffer.slice(1);
      }
    }
  }
}

export function encodeRateSet(baudRate: number, address = 0xff, sequence = 0): Uint8Array {
  if (!Number.isSafeInteger(baudRate) || baudRate <= 0 || baudRate > 0xffffffff) {
    throw new Error("Некорректная скорость UART");
  }
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, baudRate, true);
  return encodeEkosferaRequest({ address, command: EkosferaRpcId.rateSet, sequence, payload });
}
