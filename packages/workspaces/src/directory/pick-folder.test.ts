import { describe, it, expect } from 'vitest'
import { buildPickerCommand, pickFolderWithNativeDialog } from './pick-folder.js'

describe('buildPickerCommand', () => {
  it('runs the embedded Explorer-style picker on Windows — nothing on disk, nothing to quote', () => {
    const command = buildPickerCommand('win32')
    expect(command?.file).toBe('powershell.exe')
    expect(command?.args).toContain('-STA')
    expect(command?.args).toContain('-EncodedCommand')
    expect(command?.args).not.toContain('-File')
    const encoded = command!.args[command!.args.indexOf('-EncodedCommand') + 1]!
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(script).toContain('FOS_PICKFOLDERS')
    expect(script).toContain('Choose the folder your projects live in')
  })

  it('asks the OS dialog on macOS and Linux too', () => {
    expect(buildPickerCommand('darwin')?.file).toBe('osascript')
    expect(buildPickerCommand('linux')?.file).toBe('zenity')
  })

  it('has no dialog to offer elsewhere', () => {
    expect(buildPickerCommand('freebsd')).toBeNull()
  })
})

describe('pickFolderWithNativeDialog', () => {
  it('returns the picked path, trimmed', async () => {
    const picked = await pickFolderWithNativeDialog(
      async () => ({ stdout: 'C:\\dev\\letterman\r\n' }),
      'win32',
    )
    expect(picked).toBe('C:\\dev\\letterman')
  })

  it('reads empty output as cancelled — a normal answer, not an error', async () => {
    expect(await pickFolderWithNativeDialog(async () => ({ stdout: '' }), 'win32')).toBeNull()
  })

  it("reads the dialog's non-zero exit (cancel, missing binary) as cancelled", async () => {
    const picked = await pickFolderWithNativeDialog(async () => {
      throw new Error('exit 1')
    }, 'darwin')
    expect(picked).toBeNull()
  })

  it('never runs anything on a platform without a dialog', async () => {
    let runs = 0
    const picked = await pickFolderWithNativeDialog(async () => {
      runs += 1
      return { stdout: '/tmp/x' }
    }, 'freebsd')
    expect(picked).toBeNull()
    expect(runs).toBe(0)
  })
})
