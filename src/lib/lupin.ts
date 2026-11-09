import type { DemoChunk } from "./demo";

export const LUPIN_MARKER = new TextEncoder().encode("OSCILLOSCOPE");
export const LUPIN_SAMPLES_PER_PACKET = 6000;
export const LUPIN_SAMPLE_RATE = 6000;
export const LUPIN_PACKET_BYTES = LUPIN_MARKER.length + LUPIN_SAMPLES_PER_PACKET * 4;

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

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;

    while (true) {
      const marker = findMarker(this.buffer);
      if (marker < 0) {
        const keep = Math.min(this.buffer.length, LUPIN_MARKER.length - 1);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return;
      }
      if (marker > 0) this.buffer = this.buffer.slice(marker);
      if (this.buffer.length < LUPIN_PACKET_BYTES) return;

      const payload = this.buffer.subarray(LUPIN_MARKER.length, LUPIN_PACKET_BYTES);
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const samples = new Float32Array(LUPIN_SAMPLES_PER_PACKET);
      let valid = true;
      for (let i = 0; i < samples.length; i++) {
        const value = view.getFloat32(i * 4, true);
        if (!Number.isFinite(value) || value < 0) {
          valid = false;
          break;
        }
        samples[i] = value;
      }

      if (valid) {
        this.buffer = this.buffer.slice(LUPIN_PACKET_BYTES);
        const detail: DemoChunk = { samples, sampleRate: LUPIN_SAMPLE_RATE, timestamp: new Date() };
        this.dispatchEvent(new CustomEvent<DemoChunk>("packet", { detail }));
      } else {
        // A marker-like byte sequence inside invalid data must not stall synchronization.
        this.buffer = this.buffer.slice(1);
      }
    }
  }
}
