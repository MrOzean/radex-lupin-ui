export type MeasurementType = "illuminance" | "luminance";

export interface DeviceMetadata {
  name: string;
  serialNumber?: string;
  firmware?: string;
}

export interface MeasurementFileHeader {
  format: "lupin-light-lab";
  version: 1;
  encoding: "float32-le";
  createdAt: string;
  startedAt: string;
  endedAt: string;
  sampleRate: number;
  sampleCount: number;
  measurementType: MeasurementType;
  correction: number;
  filterEnabled: boolean;
  comment: string;
  source: string;
  device: DeviceMetadata | null;
}

export interface MeasurementFileData {
  header: MeasurementFileHeader;
  samples: Float32Array;
}

const MAGIC = new TextEncoder().encode("LUPINLAB");
const PREFIX_LENGTH = MAGIC.length + 4;
const MAX_HEADER_LENGTH = 1024 * 1024;

/** Binary layout: 8-byte magic, uint32 LE JSON length, UTF-8 JSON, float32 LE samples. */
export function encodeMeasurementFile(data: MeasurementFileData): ArrayBuffer {
  validateHeader(data.header, data.samples.length);
  const headerBytes = new TextEncoder().encode(JSON.stringify(data.header));
  if (headerBytes.length > MAX_HEADER_LENGTH) throw new Error("Слишком большой заголовок файла измерения");

  const output = new Uint8Array(PREFIX_LENGTH + headerBytes.length + data.samples.byteLength);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.length, headerBytes.length, true);
  output.set(headerBytes, PREFIX_LENGTH);

  const sampleBytes = new Uint8Array(
    data.samples.buffer,
    data.samples.byteOffset,
    data.samples.byteLength,
  );
  if (isLittleEndian()) {
    output.set(sampleBytes, PREFIX_LENGTH + headerBytes.length);
  } else {
    const view = new DataView(output.buffer, PREFIX_LENGTH + headerBytes.length, data.samples.byteLength);
    for (let i = 0; i < data.samples.length; i++) view.setFloat32(i * 4, data.samples[i], true);
  }
  return output.buffer;
}

export function decodeMeasurementFile(input: ArrayBuffer | Uint8Array): MeasurementFileData {
  const bytes = input instanceof Uint8Array
    ? input
    : new Uint8Array(input);
  if (bytes.length < PREFIX_LENGTH) throw new Error("Файл слишком короткий: это не запись Lupin Light Lab");
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Неизвестный формат файла. Ожидается запись .lupinlab");
  }

  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(MAGIC.length, true);
  if (headerLength === 0 || headerLength > MAX_HEADER_LENGTH || PREFIX_LENGTH + headerLength > bytes.length) {
    throw new Error("Повреждён заголовок файла измерения");
  }

  let header: MeasurementFileHeader;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(PREFIX_LENGTH, PREFIX_LENGTH + headerLength),
    )) as MeasurementFileHeader;
  } catch {
    throw new Error("Не удалось прочитать JSON-заголовок файла измерения");
  }
  validateHeader(header);

  const dataOffset = PREFIX_LENGTH + headerLength;
  const expectedBytes = header.sampleCount * 4;
  if (bytes.byteLength - dataOffset !== expectedBytes) {
    throw new Error(`Размер данных не совпадает с заголовком: ожидается ${expectedBytes} байт`);
  }

  const samples = new Float32Array(header.sampleCount);
  if (isLittleEndian()) {
    samples.set(new Float32Array(bytes.slice(dataOffset).buffer));
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, expectedBytes);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getFloat32(i * 4, true);
  }
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error("Файл содержит некорректные отсчёты");
  }
  return { header, samples };
}

function validateHeader(header: MeasurementFileHeader, actualSampleCount?: number): void {
  if (!header || typeof header !== "object") throw new Error("Заголовок файла измерения отсутствует");
  if (header.format !== "lupin-light-lab" || header.version !== 1 || header.encoding !== "float32-le") {
    throw new Error("Неподдерживаемая версия или кодировка файла измерения");
  }
  if (!Number.isSafeInteger(header.sampleCount) || header.sampleCount < 0) {
    throw new Error("Некорректное количество отсчётов в заголовке");
  }
  if (actualSampleCount !== undefined && header.sampleCount !== actualSampleCount) {
    throw new Error("Количество отсчётов не совпадает с данными");
  }
  if (!Number.isFinite(header.sampleRate) || header.sampleRate <= 1000) {
    throw new Error("Некорректная или неподдерживаемая частота дискретизации");
  }
  if (!Number.isFinite(header.correction) || header.correction <= 0) {
    throw new Error("Некорректный корректирующий множитель");
  }
  if (header.measurementType !== "illuminance" && header.measurementType !== "luminance") {
    throw new Error("Неизвестный тип измерения");
  }
  for (const key of ["createdAt", "startedAt", "endedAt"] as const) {
    if (typeof header[key] !== "string" || !Number.isFinite(Date.parse(header[key]))) {
      throw new Error(`Некорректная дата в поле ${key}`);
    }
  }
  if (typeof header.filterEnabled !== "boolean" || typeof header.comment !== "string" || typeof header.source !== "string") {
    throw new Error("Некорректные метаданные измерения");
  }
  if (header.device !== null && (typeof header.device !== "object" || typeof header.device.name !== "string")) {
    throw new Error("Некорректные метаданные прибора");
  }
}

function isLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}
