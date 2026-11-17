"""Capture official RadexLight stat getters together with the real serial stream.

Runs RadexLight under Frida with radex_stats_hook.js: hooks the EsEapData
scalar getters (minimum/maximum/mean/flicker variants) and logs the real
ReadFile traffic, so official numbers can be correlated with candidate
formulas computed on the very same packets.
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
OUTPUT = ROOT / f"official-stats-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.jsonl"


def main() -> None:
    finished = threading.Event()
    output = OUTPUT.open("w", encoding="utf-8")

    def write(message: dict) -> None:
        message.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        output.write(json.dumps(message, ensure_ascii=False) + "\n")
        output.flush()
        kind = message.get("kind")
        if kind == "stat":
            print(f"STAT {message['name']} = {message['value']:.6f}", flush=True)
        elif kind == "read":
            pass  # too noisy to print
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
        script = session.create_script((ROOT / "radex_stats_hook.js").read_text(encoding="utf-8"))
        script.on("message", on_message)
        script.load()
        frida.resume(pid)
        print("Capture running. Start/stop a measurement in RadexLight, then close it.", flush=True)
        finished.wait()
    except KeyboardInterrupt:
        pass
    finally:
        output.close()
        print(f"Saved to {OUTPUT}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
