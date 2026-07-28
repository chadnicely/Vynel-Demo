import { describe, it, expect } from 'vitest'
import { parsePreflightReport } from './preflight.js'

const debianReport = [
  'arch=x86_64',
  'libc=ldd (Debian GLIBC 2.41-12+deb13u3) 2.41',
  'systemd=yes',
  'tar=yes',
  'home=/home/dana',
].join('\n')

describe('parsePreflightReport', () => {
  it('accepts a glibc systemd x86_64 server and maps the arch', () => {
    expect(parsePreflightReport(debianReport)).toEqual({ arch: 'x64', home: '/home/dana' })
  })

  it('maps aarch64 to arm64', () => {
    expect(parsePreflightReport(debianReport.replace('x86_64', 'aarch64')).arch).toBe('arm64')
  })

  it('rejects musl with a message that names the gap', () => {
    const muslReport = debianReport.replace(/libc=.*$/m, 'libc=musl libc (x86_64) Version 1.2.4')
    expect(() => parsePreflightReport(muslReport)).toThrow(/musl|glibc/i)
  })

  it('rejects a server without systemd', () => {
    expect(() => parsePreflightReport(debianReport.replace('systemd=yes', 'systemd=no'))).toThrow(
      /systemd/,
    )
  })

  it('rejects an unsupported CPU', () => {
    expect(() => parsePreflightReport(debianReport.replace('x86_64', 'riscv64'))).toThrow(/CPU/)
  })

  it('rejects a missing tar', () => {
    expect(() => parsePreflightReport(debianReport.replace('tar=yes', 'tar=no'))).toThrow(/tar/)
  })
})
