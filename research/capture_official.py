"""Capture RadexLight serial traffic using Frida without changing the device or drivers."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

import frida

ROOT = Path(__file__).resolve().parent
EXE = Path(r"D:\Apps\radexlight32\radexlight.exe")
OUTPUT = ROOT / "official-serial.jsonl"


def main() -> None:
    finished = threading.Event()
    output = OUTPUT.open("w", encoding="utf-8")

    def write(message: dict) -> None:
        message.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        output.write(json.dumps(message, ensure_ascii=False) + "\n")
        output.flush()
        kind = message.get("kind")
        if kind == "write":
            print(f"TX {message.get('length')} bytes: {message.get('hex')}", flush=True)
        elif kind == "read":
            print(f"RX {message.get('length')} bytes", flush=True)
        else:
            print(json.dumps(message, ensure_ascii=False), flush=True)

    def on_message(message: dict, data: bytes | None) -> None:
        if message.get("type") == "send":
            write(message["payload"])
        else:
            write({"kind": "frida", "message": message})

    def on_detached(reason: str, crash: dict | None) -> None:
        write({"kind": "detached", "reason": reason, "crash": crash})
        finished.set()

    try:
        pid = frida.spawn([str(EXE)], cwd=str(EXE.parent))
        print(f"RadexLight PID: {pid}", flush=True)
        session = frida.attach(pid)
        session.on("detached", on_detached)
        script = session.create_script((ROOT / "radex_serial_hook.js").read_text(encoding="utf-8"))
        script.on("message", on_message)
        script.load()
        frida.resume(pid)
        print("Capture ready. Start and stop a measurement in RadexLight, then close it.", flush=True)
        finished.wait()
    except KeyboardInterrupt:
        pass
    finally:
        output.close()
        print(f"Saved to {OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
