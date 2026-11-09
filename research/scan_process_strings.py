"""Search readable process memory for protocol-related strings not present on disk."""

from __future__ import annotations

import ctypes
import re
import sys
from ctypes import wintypes
from pathlib import Path

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
    ]


def main() -> None:
    pid = int(sys.argv[1])
    folder = Path(r"D:\Apps\radexlight32")
    ascii_pattern = re.compile(rb"[\x20-\x7e]{4,}")
    utf16_pattern = re.compile(rb"(?:[\x20-\x7e]\x00){3,}")
    known: set[str] = set()
    for name in ("radexlight.exe", "esfwx_v1_28_1_vc143.dll", "sk4d.dll"):
        data = (folder / name).read_bytes()
        known.update(match.group().decode("ascii") for match in ascii_pattern.finditer(data))
        known.update(match.group().decode("utf-16le") for match in utf16_pattern.finditer(data))

    keyword = re.compile(
        r"eap|ekos|oscill|marker|chunk|retry|retries|timeout|baud|uart|serial|lupin|"
        r"firmware|illum|lumin|flicker|calibr|rate|command|packet|frame|device|"
        r"start|stop|ping|rpc|health|reset|bootloader|context|channel|read|write",
        re.I,
    )
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    process = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not process:
        raise ctypes.WinError(ctypes.get_last_error())

    address = 0
    matches: set[str] = set()
    try:
        while address < 0x7FFF0000:
            mbi = MEMORY_BASIC_INFORMATION()
            result = kernel32.VirtualQueryEx(
                process, ctypes.c_void_p(address), ctypes.byref(mbi), ctypes.sizeof(mbi)
            )
            if not result:
                break
            base = int(mbi.BaseAddress or 0)
            size = int(mbi.RegionSize)
            if (
                mbi.State == MEM_COMMIT
                and not (mbi.Protect & PAGE_GUARD)
                and not (mbi.Protect & PAGE_NOACCESS)
                and 0 < size <= 256 * 1024 * 1024
            ):
                buffer = ctypes.create_string_buffer(size)
                read = ctypes.c_size_t()
                if kernel32.ReadProcessMemory(
                    process,
                    ctypes.c_void_p(base),
                    buffer,
                    size,
                    ctypes.byref(read),
                ):
                    data = buffer.raw[: read.value]
                    for pattern, encoding in ((ascii_pattern, "ascii"), (utf16_pattern, "utf-16le")):
                        for match in pattern.finditer(data):
                            raw = match.group()
                            text = raw.decode(encoding)
                            if text in known:
                                continue
                            if keyword.search(text) and text not in matches:
                                matches.add(text)
                                print(f"{base + match.start():016X} {text}")
            address = base + size
    finally:
        kernel32.CloseHandle(process)


if __name__ == "__main__":
    main()
