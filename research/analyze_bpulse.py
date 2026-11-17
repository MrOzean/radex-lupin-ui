"""Extract the known RadexLight 1.18 unpacked BPULSE EsMathArrayReal representation."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

RECORD_ZERO_PREFIX = bytes.fromhex(
    "08 00 00 00 2f 00 00 00 00 00 00 00 "
    "02 00 00 00 03 00 00 00 49 44 58"
)
# The record payload is a float64 ("08 00 00 00" length marker precedes it).
VALUE_OFFSET = 47
RECORD_STRIDE = 55


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def extract(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 1600 or data[12:16] != b"ROOT" or data[1334:1338] != b"Data":
        raise ValueError("Not the known unpacked RadexLight BPULSE layout")

    record = data.find(RECORD_ZERO_PREFIX)
    if record < 0:
        raise ValueError("First EsMathArrayReal record was not found")

    samples: list[float] = []
    value_offset = record + VALUE_OFFSET
    index = 0
    while value_offset + 8 <= len(data):
        # Every record except the final truncated one carries IDX twice.
        if value_offset + 8 < len(data):
            if u32(data, value_offset - 39) != index or u32(data, value_offset - 20) != index:
                raise ValueError(f"Unexpected BPULSE record index at sample {index}")
            if data[value_offset - 27:value_offset - 24] != b"IDX":
                raise ValueError(f"Unexpected BPULSE record marker at sample {index}")
        value = struct.unpack_from("<d", data, value_offset)[0]
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"Invalid sample {index}: {value}")
        samples.append(value)
        value_offset += RECORD_STRIDE
        index += 1

    if not samples:
        raise ValueError("BPULSE contains no samples")
    packed = struct.pack(f"<{len(samples)}d", *samples)
    minimum = min(samples)
    maximum = max(samples)
    mean = sum(samples) / len(samples)
    return {
        "file": str(path),
        "bytes": len(data),
        "deviceType": u32(data, 0xA3),
        "device": data[0xD1:0xE0].decode("ascii"),
        "order": u32(data, 0x1C3),
        "firmwareDate": f"{u32(data, 0x206):04d}-{data[0x249]:02d}-{data[0x287]:02d}",
        "firmware": f"{data[0x34F]}.{data[0x38F]}",
        "countryCode": u32(data, 0x3D6),
        "sampleCount": len(samples),
        "sampleSha256": hashlib.sha256(packed).hexdigest(),
        "minimum": minimum,
        "maximum": maximum,
        "mean": mean,
        "flickerPercent": ((maximum - minimum) / mean * 100) if mean else 0,
        "firstSamples": samples[:8],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = [extract(path) for path in args.files]
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
