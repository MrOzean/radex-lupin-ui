import type { DemoChunk } from "./demo";

export const LUPIN_MARKER = new TextEncoder().encode("OSCILLOSCOPE");
export const LUPIN_SAMPLES_PER_PACKET = 6000;
export const LUPIN_SAMPLE_RATE = 6000;
export const LUPIN_PACKET_BYTES = LUPIN_MARKER.length + LUPIN_SAMPLES_PER_PACKET * 4;
// LUPIN specification: illuminance 10–200000 lux, luminance 3–70000 cd/m².
// Zero is allowed for dark measurements; the upper bound is only a corruption guard.
export const LUPIN_MAX_REASONABLE_SAMPLE = 200_000;

export interface LupinStreamDiagnostics {
  bytesReceived: number;
  packetsReceived: number;
  discardedBytes: number;
  invalidPackets: number;
  resyncEvents: number;
}

const EMPTY_DIAGNOSTICS: LupinStreamDiagnostics = {
  bytesReceived: 0,
  packetsReceived: 0,
  discardedBytes: 0,
  invalidPackets: 0,
  resyncEvents: 0,
};

function findMarker(buffer: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= buffer.length - LUPIN_MARKER.length; i++) {
    for (let j = 0; j < LUPIN_MARKER.length; j++) {
      if (buffer[i + j] !== LUPIN_MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Incremental parser for LUPIN's live oscilloscope stream. */
export class LupinStreamParser extends EventTarget {
  private buffer = new Uint8Array(0);
  private stats: LupinStreamDiagnostics = { ...EMPTY_DIAGNOSTICS };

  get diagnostics(): LupinStreamDiagnostics {
    return { ...this.stats };
  }

  reset(clearDiagnostics = false): void {
    this.buffer = new Uint8Array(0);
    if (clearDiagnostics) this.stats = { ...EMPTY_DIAGNOSTICS };
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.stats.bytesReceived += chunk.length;
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;

    while (true) {
      const marker = findMarker(this.buffer);
      if (marker < 0) {
        const keep = Math.min(this.buffer.length, LUPIN_MARKER.length - 1);
        const discarded = this.buffer.length - keep;
        if (discarded > 0) {
          this.stats.discardedBytes += discarded;
          this.stats.resyncEvents++;
        }
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return;
      }
      if (marker > 0) {
        this.buffer = this.buffer.slice(marker);
        this.stats.discardedBytes += marker;
        this.stats.resyncEvents++;
      }
      if (this.buffer.length < LUPIN_PACKET_BYTES) return;

      const payload = this.buffer.subarray(LUPIN_MARKER.length, LUPIN_PACKET_BYTES);
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const samples = new Float32Array(LUPIN_SAMPLES_PER_PACKET);
      let valid = true;
      for (let i = 0; i < samples.length; i++) {
        const value = view.getFloat32(i * 4, true);
        if (!Number.isFinite(value) || value < 0 || value > LUPIN_MAX_REASONABLE_SAMPLE) {
          valid = false;
          break;
        }
        samples[i] = value;
      }

      if (valid) {
        this.buffer = this.buffer.slice(LUPIN_PACKET_BYTES);
        this.stats.packetsReceived++;
        const detail: DemoChunk = { samples, sampleRate: LUPIN_SAMPLE_RATE, timestamp: new Date() };
        this.dispatchEvent(new CustomEvent<DemoChunk>("packet", { detail }));
      } else {
        // A marker-like byte sequence inside invalid data must not stall synchronization.
        this.buffer = this.buffer.slice(1);
        this.stats.discardedBytes++;
        this.stats.invalidPackets++;
        this.stats.resyncEvents++;
      }
    }
  }
}
