"""Capture serial input without transmitting anything to the device."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import serial


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port")
    parser.add_argument("output", type=Path)
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--wake", action="store_true", help="Perform the observed 9600-baud close/reopen cycle first")
    args = parser.parse_args()

    if args.wake:
        with serial.Serial(args.port, 9600, bytesize=8, parity="N", stopbits=1, timeout=0.1) as wake:
            wake.rts = False
            wake.dtr = False
            time.sleep(0.05)
            wake.dtr = True
            wake.reset_input_buffer()
            wake.reset_output_buffer()
            time.sleep(0.1)
            wake.dtr = False
        time.sleep(0.5)

    received = bytearray()
    with serial.Serial(args.port, args.baud, bytesize=8, parity="N", stopbits=1, timeout=0.1) as port:
        port.rts = False
        port.dtr = False
        time.sleep(0.05)
        port.dtr = True
        port.reset_input_buffer()
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            received.extend(port.read(max(1, port.in_waiting)))

    args.output.write_bytes(received)
    print(f"Captured {len(received)} bytes to {args.output}")


if __name__ == "__main__":
    main()
