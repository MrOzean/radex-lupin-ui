"""Small PE32 string-reference/disassembly helper for the RadexLight protocol research."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32


def parse_int(value: str) -> int:
    return int(value, 0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    parser.add_argument("offsets", nargs="*", type=parse_int, help="String file offsets")
    parser.add_argument("--before", type=parse_int, default=0x100)
    parser.add_argument("--after", type=parse_int, default=0x180)
    parser.add_argument("--range", help="Disassemble a file-offset range, for example 0x1000:0x1100")
    parser.add_argument("--calls", nargs="*", type=parse_int, help="Find direct calls to virtual addresses")
    args = parser.parse_args()

    data = args.file.read_bytes()
    pe = pefile.PE(data=data, fast_load=True)
    image_base = pe.OPTIONAL_HEADER.ImageBase
    md = Cs(CS_ARCH_X86, CS_MODE_32)

    if args.range:
        range_start, range_end = (parse_int(item) for item in args.range.split(":", 1))
        code_va = image_base + pe.get_rva_from_offset(range_start)
        print(f"=== File range {range_start:#x}:{range_end:#x}, VA {code_va:#x} ===")
        for instruction in md.disasm(data[range_start:range_end], code_va):
            print(f"    {instruction.address:08X} {instruction.mnemonic:8} {instruction.op_str}")

    executable_sections = [
        section
        for section in pe.sections
        if section.Characteristics & 0x20000000
    ]

    for target in args.calls or []:
        print(f"\n=== Direct calls to {target:#x} ===")
        for section in executable_sections:
            section_data = data[
                section.PointerToRawData : section.PointerToRawData + section.SizeOfRawData
            ]
            section_va = image_base + section.VirtualAddress
            for position, byte in enumerate(section_data[:-4]):
                if byte != 0xE8:
                    continue
                displacement = struct.unpack_from("<i", section_data, position + 1)[0]
                source_va = section_va + position
                if source_va + 5 + displacement == target:
                    file_offset = section.PointerToRawData + position
                    print(f"  call at file {file_offset:#x}, VA {source_va:#x}")

    for string_offset in args.offsets:
        print(f"\n=== String file offset {string_offset:#x} ===")
        for delta in (0, -1):
            rva = pe.get_rva_from_offset(string_offset + delta)
            va = image_base + rva
            needle = struct.pack("<I", va)
            positions: list[int] = []
            start = 0
            while True:
                position = data.find(needle, start)
                if position < 0:
                    break
                positions.append(position)
                start = position + 1

            print(f"Target {va:#x} (string delta {delta}): {len(positions)} reference(s)")
            for position in positions:
                section = next(
                    (
                        item
                        for item in executable_sections
                        if item.PointerToRawData <= position < item.PointerToRawData + item.SizeOfRawData
                    ),
                    None,
                )
                if section is None:
                    print(f"  {position:#x}: outside executable sections")
                    continue

                code_start = max(section.PointerToRawData, position - args.before)
                code_end = min(
                    section.PointerToRawData + section.SizeOfRawData,
                    position + args.after,
                )
                code_va = image_base + pe.get_rva_from_offset(code_start)
                print(f"  Reference at file {position:#x}, VA {image_base + pe.get_rva_from_offset(position):#x}")
                for instruction in md.disasm(data[code_start:code_end], code_va):
                    instruction_offset = pe.get_offset_from_rva(instruction.address - image_base)
                    marker = ">>>" if instruction_offset == position else "   "
                    print(
                        f"    {marker} {instruction.address:08X} "
                        f"{instruction.mnemonic:8} {instruction.op_str}"
                    )


if __name__ == "__main__":
    main()
