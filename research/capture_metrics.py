"""Capture official RadexLight getter values together with the raw serial stream.

Runs RadexLight under Frida with radex_metrics_hook.js: polls the EsEapData
RTTI getters once per second (official minimum/maximum/mean/flicker values)
and logs every ReadFile from the LUPIN COM port, enabling offline correlation
of official numbers with candidate formulas on the same packets.
"""

from __future__ import annotations

import json
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

import frida

ROOT = Path(__file__).resolve().parent
EXE = Path(r"D:\Apps\radexlight32\radexlight.exe")
OUTPUT = ROOT / f"official-metrics-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.jsonl"


def main() -> None:
    finished = threading.Event()
    output = OUTPUT.open("w", encoding="utf-8")

    def write(message: dict) -> None:
        message.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        output.write(json.dumps(message, ensure_ascii=False) + "\n")
        output.flush()
        kind = message.get("kind")
        if kind == "official":
            print(f"OFFICIAL {message['name']:20s} = {message['value']:.6f}", flush=True)
        elif kind != "read":
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
        script = session.create_script((ROOT / "radex_metrics_hook.js").read_text(encoding="utf-8"))
        script.on("message", on_message)
        script.load()
        frida.resume(pid)
        print("Capture running. Start a measurement in RadexLight, wait ~60 s, then close it.", flush=True)
        finished.wait()
    except KeyboardInterrupt:
        pass
    finally:
        output.close()
        print(f"Saved to {OUTPUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
