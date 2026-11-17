"""Decode the script-variant layout and correlate official values with packets.

Pairs each meanIntegral property-raw dump with the adjacent property-value
(the exact double the UI received) to find where the value lives in the
variant, then extracts official minimum/maximum/flicker from their raw dumps
and prints them alongside candidate formulas computed on the serial stream.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MARKER = b"OSCILLOSCOPE"
PACKET = len(MARKER) + 6000 * 4


def packets_from_reads(events: list[dict]) -> list[tuple[str, list[float]]]:
    stream = bytearray()
    for ev in events:
        if ev.get("kind") == "read":
            stream.extend(bytes.fromhex(ev["hex"]))
    packets: list[tuple[str, list[float]]] = []
    offset = 0
    while True:
        start = stream.find(MARKER, offset)
        if start < 0 or start + PACKET > len(stream):
            break
        payload = bytes(stream[start + len(MARKER): start + PACKET])
        packets.append((ev_ts(events, start), list(struct.unpack("<6000f", payload))))
        offset = start + PACKET
    return packets


def ev_ts(events: list[dict], byte_offset: int) -> str:
    # approximate timestamp by proportional position between first/last read
    return ""


def stats(samples: list[float]) -> dict:
    mn = min(samples)
    mx = max(samples)
    mean = sum(samples) / len(samples)
    integral = sum(samples) - (samples[0] + samples[-1]) / 2
    mean_integral = integral / (len(samples) - 1)
    return {
        "minimum": mn,
        "maximum": mx,
        "meanArithmetic": mean,
        "meanIntegral": mean_integral,
        "flickerArithmetic": (mx - mn) / mean * 100 if mean else 0.0,
        "flickerIntegral": (mx - mn) / mean_integral * 100 if mean_integral else 0.0,
    }


def find_value_offset(raws: list[tuple[dict, float]]) -> int | None:
    for raw, val in raws[:5]:
        target = struct.pack("<d", val).hex()
        idx = raw["hex"].find(target)
        if idx >= 0 and idx % 1 == 0:
            return idx
        pay = raw.get("payloadHex", "")
        idx = pay.find(target)
        if idx >= 0:
            return -(idx + 1)  # negative = payload offset
    return None


def main() -> None:
    path = Path(sys.argv[1])
    events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    # 1. locate the double inside the variant dumps using meanIntegral pairs
    pairs: list[tuple[dict, float]] = []
    for i, ev in enumerate(events):
        if ev.get("kind") == "property-raw" and ev["name"] == "meanIntegral":
            for j in range(i + 1, min(i + 4, len(events))):
                nxt = events[j]
                if nxt.get("kind") == "property-value" and nxt["name"] == "meanIntegral":
                    pairs.append((ev, nxt["value"]))
                    break
    print(f"meanIntegral raw/value pairs: {len(pairs)}")
    for raw, val in pairs[:8]:
        target = struct.pack("<d", val).hex()
        print(f"  val={val:.6f} hex@{raw['hex'].find(target)} payload@{raw.get('payloadHex','').find(target)}")

    # 2. official values captured via direct getters (if any)
    officials: dict[str, list[float]] = {}
    for ev in events:
        if ev.get("kind") == "official":
            officials.setdefault(ev["name"], []).append(ev["value"])
    print("\nofficial getter values:")
    for name, vals in sorted(officials.items()):
        uniq = sorted({round(v, 6) for v in vals})
        print(f"  {name:20s} n={len(vals):4d} uniq={uniq[:10]}")

    # 3. candidate formulas on captured packets
    packets = []
    stream = bytearray()
    for ev in events:
        if ev.get("kind") == "read":
            stream.extend(bytes.fromhex(ev["hex"]))
    offset = 0
    while True:
        start = stream.find(MARKER, offset)
        if start < 0 or start + PACKET > len(stream):
            break
        payload = bytes(stream[start + len(MARKER): start + PACKET])
        packets.append(list(struct.unpack("<6000f", payload)))
        offset = start + PACKET
    print(f"\ncaptured packets: {len(packets)}")
    for i, samples in enumerate(packets[:12]):
        c = stats(samples)
        print(
            f"packet {i}: min={c['minimum']:.4f} max={c['maximum']:.4f} "
            f"meanA={c['meanArithmetic']:.4f} meanI={c['meanIntegral']:.4f} "
            f"flickA={c['flickerArithmetic']:.4f}% flickI={c['flickerIntegral']:.4f}%"
        )


if __name__ == "__main__":
    main()
