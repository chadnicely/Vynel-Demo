// Cross-building a linux payload on a Windows host has one silent failure
// mode: an install script (node-gyp fallback) compiles for the HOST and drops
// a PE binary into a linux tree, which an existence check happily passes.
// Reading the magic bytes is the cheap, honest guard. For ELF the arch rides
// e_machine too — an x64 addon in a linux-arm64 payload is just as broken.

import { closeSync, openSync, readSync } from 'node:fs'
import type { PayloadTarget } from './payload-targets.js'

export type NativeBinaryFormat = 'elf-x64' | 'elf-arm64' | 'elf-other' | 'pe' | 'unknown'

const ELF_MACHINE_X64 = 0x3e
const ELF_MACHINE_AARCH64 = 0xb7

export function readNativeBinaryFormat(filePath: string): NativeBinaryFormat {
  const header = Buffer.alloc(20)
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, header, 0, 20, 0)
  } finally {
    closeSync(fd)
  }
  if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
    const machine = header.readUInt16LE(18)
    if (machine === ELF_MACHINE_X64) return 'elf-x64'
    if (machine === ELF_MACHINE_AARCH64) return 'elf-arm64'
    return 'elf-other'
  }
  if (header[0] === 0x4d && header[1] === 0x5a) return 'pe'
  return 'unknown'
}

export function expectedNativeBinaryFormat(target: PayloadTarget): NativeBinaryFormat {
  // PE arch stays uninspected — Windows payloads build on the host itself, so
  // a wrong-arch PE can't occur the way a cross-built ELF can.
  if (target.os === 'win32') return 'pe'
  return target.cpu === 'arm64' ? 'elf-arm64' : 'elf-x64'
}
