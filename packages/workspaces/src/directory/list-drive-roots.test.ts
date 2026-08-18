import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { listDriveRoots, parseWindowsVolumes } from './list-drive-roots.js'

describe('listDriveRoots', () => {
  it('lists at least the drive the home directory lives on, with capacity', async () => {
    const drives = await listDriveRoots()
    const homeRoot = path.parse(os.homedir()).root
    const homeDrive = drives.find((drive) => drive.path.toLowerCase() === homeRoot.toLowerCase())

    expect(homeDrive).toBeDefined()
    expect(homeDrive!.totalBytes).toBeGreaterThan(0)
    expect(homeDrive!.freeBytes).toBeGreaterThanOrEqual(0)
    expect(homeDrive!.freeBytes!).toBeLessThanOrEqual(homeDrive!.totalBytes!)
  })

  it('never returns an empty label — null stands in for an unlabeled volume', async () => {
    const drives = await listDriveRoots()
    for (const drive of drives) {
      expect(drive.label === null || drive.label.length > 0).toBe(true)
    }
  })
})

describe('parseWindowsVolumes', () => {
  it('maps a ConvertTo-Json array by upper-cased device id, blank label → null, type → kind', () => {
    const volumes = parseWindowsVolumes(
      '[{"DeviceID":"C:","VolumeName":"","DriveType":3},' +
        '{"DeviceID":"d:","VolumeName":"KAFI","DriveType":2},' +
        '{"DeviceID":"Z:","VolumeName":"Share","DriveType":4},' +
        '{"DeviceID":"Y:","VolumeName":"Disc","DriveType":5}]',
    )
    expect(volumes.get('C:')).toEqual({ label: null, kind: 'fixed' })
    expect(volumes.get('D:')).toEqual({ label: 'KAFI', kind: 'removable' })
    expect(volumes.get('Z:')).toEqual({ label: 'Share', kind: 'network' })
    expect(volumes.get('Y:')).toEqual({ label: 'Disc', kind: 'optical' })
  })

  it('accepts the bare object ConvertTo-Json emits for a single drive', () => {
    const volumes = parseWindowsVolumes('{"DeviceID":"C:","VolumeName":"OS","DriveType":3}\r\n')
    expect(volumes.get('C:')).toEqual({ label: 'OS', kind: 'fixed' })
  })

  it('tolerates empty output, missing fields, and unknown drive types', () => {
    expect(parseWindowsVolumes('').size).toBe(0)
    expect(parseWindowsVolumes('   ').size).toBe(0)
    const volumes = parseWindowsVolumes(
      '[{"DeviceID":"C:"},{"VolumeName":"orphan"},{"DeviceID":"E:","VolumeName":"X","DriveType":99}]',
    )
    expect(volumes.get('C:')).toEqual({ label: null, kind: 'unknown' })
    expect(volumes.get('E:')).toEqual({ label: 'X', kind: 'unknown' })
    expect(volumes.size).toBe(2)
  })
})
