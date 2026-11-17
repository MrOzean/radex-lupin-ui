"""Correlate official RadexLight stat getters with candidate formulas.

Parses an official-stats-*.jsonl produced by capture_stats.py, reconstructs the
same oscilloscope packets from passive-com5.bin, and checks which candidate
formula reproduces each official getter value.
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MARKER = b"OSCILLOSCOPE"
PACKET = len(MARKER) + 6000 * 4


def packets_from_capture(path: Path) -> list[list[float]]:
    data = path.read_bytes()
    packets: list[list[float]] = []
    offset = 0
    while True:
        start = data.find(MARKER, offset)
        if start < 0 or start + PACKET > len(data):
            break
        payload = data[start + len(MARKER): start + PACKET]
        samples = list(struct.unpack("<6000f", payload))
        packets.append(samples)
        offset = start + PACKET
    return packets


def stats(samples: list[float]) -> dict:
    mn = min(samples)
    mx = max(samples)
    mean = sum(samples) / len(samples)
    # Integral (trapezoid) mean over the 1-second window.
    integral = sum(samples) - (samples[0] + samples[-1]) / 2
    mean_integral = integral / (len(samples) - 1)
    return {
        "minimum": mn,
        "maximum": mx,
        "meanArithmetic": mean,
        "meanIntegral": mean_integral,
        "flickerArithmetic": (mx - mn) / mean * 100 if mean else 0.0,
        "flickerIntegral": (mx - mn) / mean_integral * 100 if mean_integral else 0.0,
        "flickerMaxMinHalf": (mx - mn) / ((mx + mn) / 2) * 100 if (mx + mn) else 0.0,
    }


def main() -> None:
    jsonl = Path(sys.argv[1])
    official: dict[str, list[float]] = {}
    for line in jsonl.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        if event.get("kind") == "stat" and math.isfinite(event.get("value", float("nan"))):
            official.setdefault(event["name"], []).append(event["value"])

    if not official:
        print("No stat events captured.")
        return

    print("=== official getter values (unique, rounded) ===")
    for name, values in official.items():
        uniq = sorted({round(v, 6) for v in values})
        print(f"{name:20s} n={len(values):4d} unique={uniq[:8]}")

    packets = packets_from_capture(ROOT / "passive-com5.bin")
    print(f"\n=== candidate formulas on {len(packets)} replayed packets ===")
    for index, samples in enumerate(packets):
        computed = stats(samples)
        print(f"packet {index}: " + " ".join(f"{k}={v:.6f}" for k, v in computed.items()))


if __name__ == "__main__":
    main()
