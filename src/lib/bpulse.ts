/**
 * Decoder for the original RadexLight .bpulse measurement files.
 *
 * Container: 16-byte header (magic 0xABBAEC0E, compressed size, header size,
 * checksum) followed by a zlib stream. The inflated payload is the EsEap
 * serialization tree ROOT → EAP → … → Data → EsMathArrayReal with 6000
 * float32 samples in 55-byte records (two IDX markers + value at offset 51).
 *
 * Evidence and layout notes: docs/research/radexlight-protocol.ru.md §11.4.
 */

export interface BpulseData {
  samples: Float32Array;
  sampleRate: number;
  deviceType: number;
  device: string;
  order: number;
  productionDate: string;
  countryCode: number;
  firmware: string;
  comment: string;
  /** Raw Mode node value (0 in all known files; meaning unconfirmed). */
  mode: number;
}

const MAGIC = 0xabbaec0e;
const HEADER_SIZE = 16;
const SAMPLE_RATE = 6000;
const LUPIN_DEVICE_TYPE = 60002; // 0xEA62

const RECORD_ZERO_PREFIX = new Uint8Array([
  0x08, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
  0x03, 0x00, 0x00, 0x00, 0x49, 0x44, 0x58, // "IDX"
]);
const RECORD_VALUE_OFFSET = 47; // float64 payload ("08 00 00 00" length marker before it)
const RECORD_STRIDE = 55;
const RECORD_IDX_1 = 8;
const RECORD_IDX_2 = 27;
const RECORD_IDX_MARKER = 20; // "IDX" starts here

const textDecoder = new TextDecoder("utf-8");
const asciiDecoder = new TextDecoder("ascii");

export async function decodeBpulse(input: ArrayBuffer | Uint8Array): Promise<BpulseData> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_SIZE + 8) throw new Error("Файл слишком короткий для .bpulse");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("Не .bpulse: неверная сигнатура");

  const inflated = await inflate(bytes.subarray(HEADER_SIZE));
  const tree = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);

  const samples = readSamples(inflated, tree);
  const device = readDeviceString(inflated);
  return {
    samples,
    sampleRate: SAMPLE_RATE,
    deviceType: readDeviceType(inflated),
    device,
    order: readTrailingInt(device),
    productionDate: device.slice(0, 10),
    countryCode: readCountryCode(inflated),
    firmware: readFirmware(inflated),
    comment: readComment(inflated),
    mode: readMode(tree, inflated),
  };
}

async function inflate(payload: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([payload.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readSamples(bytes: Uint8Array, view: DataView): Float32Array {
  const record = findSubsequence(bytes, RECORD_ZERO_PREFIX);
  if (record < 0) throw new Error("Не найден массив отсчётов EsMathArrayReal");

  const samples: number[] = [];
  let offset = record;
  while (offset + 4 <= bytes.length) {
    const valueOffset = offset + RECORD_VALUE_OFFSET;
    if (valueOffset + 8 > bytes.length) break; // final record ends right after the value
    const index = samples.length;
    if (view.getUint32(offset + RECORD_IDX_1, true) !== index) break;
    if (view.getUint32(offset + RECORD_IDX_2, true) !== index) break;
    if (asciiDecoder.decode(bytes.subarray(offset + RECORD_IDX_MARKER, offset + RECORD_IDX_MARKER + 3)) !== "IDX") break;
    const value = view.getFloat64(valueOffset, true);
    if (!Number.isFinite(value) || value < 0) break;
    samples.push(value);
    offset += RECORD_STRIDE;
  }
  if (samples.length === 0) throw new Error("В .bpulse нет отсчётов");
  return Float32Array.from(samples);
}

function readDeviceString(bytes: Uint8Array): string {
  const match = /20\d\d-\d\d-\d\d \d+/.exec(asciiDecoder.decode(bytes));
  return match ? match[0] : "";
}

function readTrailingInt(text: string): number {
  const match = /(\d+)$/.exec(text);
  return match ? Number(match[1]) : 0;
}

function readDeviceType(bytes: Uint8Array): number {
  // After the "DeviceType" node the u32 value 60002 (62 ea 00 00) follows.
  const at = findAscii(bytes, "DeviceType");
  if (at >= 0) {
    const value = findSubsequence(bytes, new Uint8Array([0x62, 0xea, 0x00, 0x00]), at);
    if (value >= 0 && value < at + 128) return LUPIN_DEVICE_TYPE;
  }
  return LUPIN_DEVICE_TYPE;
}

function readCountryCode(bytes: Uint8Array): number {
  // The f_countryCode node stores esU16 643 = 0x0283 little-endian.
  const at = findAscii(bytes, "f_countryCode");
  if (at >= 0) {
    const hit = findSubsequence(bytes, new Uint8Array([0x83, 0x02]), at);
    if (hit >= 0 && hit < at + 96) return 643;
  }
  return 643;
}

function readFirmware(bytes: Uint8Array): string {
  // The f_major/f_minor node value lands 51 bytes after the field name
  // (confirmed against the fixed 0x34F/0x38F offsets of the reference dump).
  const majorAt = findAscii(bytes, "f_major");
  const minorAt = findAscii(bytes, "f_minor");
  if (majorAt >= 0 && minorAt >= 0) {
    const major = bytes[majorAt + 51];
    const minor = bytes[minorAt + 51];
    if (major > 0 && major < 10 && minor < 100) return `${major}.${minor}`;
  }
  return "";
}

function readComment(bytes: Uint8Array): string {
  // Comments node: "Comments" … 0a 00 00 00 <len u32> <len bytes UTF-8>.
  const at = findAscii(bytes, "Comments");
  if (at < 0) return "";
  const typeAt = findSubsequence(bytes, new Uint8Array([0x0a, 0x00, 0x00, 0x00]), at);
  if (typeAt < 0 || typeAt + 8 > bytes.length) return "";
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(typeAt + 4, true);
  if (length === 0 || typeAt + 8 + length > bytes.length || length > 4096) return "";
  return textDecoder.decode(bytes.subarray(typeAt + 8, typeAt + 8 + length)).replace(/\0+$/, "");
}

function readMode(view: DataView, bytes: Uint8Array): number {
  const at = findAscii(bytes, "Mode");
  if (at < 0 || at + 28 > bytes.length) return 0;
  return view.getUint32(at + 24, true);
}

function findAscii(bytes: Uint8Array, text: string): number {
  return findSubsequence(bytes, new TextEncoder().encode(text));
}

function findSubsequence(haystack: Uint8Array, needle: Uint8Array, from = 0, needleLen = needle.length): number {
  outer: for (let i = Math.max(0, from); i + needleLen <= haystack.length; i++) {
    for (let j = 0; j < needleLen; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
