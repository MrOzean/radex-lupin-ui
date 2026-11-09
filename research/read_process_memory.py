"""Read a small block from a local process for interoperability research."""

from __future__ import annotations

import ctypes
import sys
from pathlib import Path

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010


def main() -> None:
    pid = int(sys.argv[1], 0)
    address = int(sys.argv[2], 0)
    size = int(sys.argv[3], 0)
    output = Path(sys.argv[4])

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    process = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not process:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        buffer = ctypes.create_string_buffer(size)
        read = ctypes.c_size_t()
        if not kernel32.ReadProcessMemory(
            process, ctypes.c_void_p(address), buffer, size, ctypes.byref(read)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        output.write_bytes(buffer.raw[: read.value])
        print(f"Wrote {read.value} bytes from {address:#x} to {output}")
    finally:
        kernel32.CloseHandle(process)


if __name__ == "__main__":
    main()
