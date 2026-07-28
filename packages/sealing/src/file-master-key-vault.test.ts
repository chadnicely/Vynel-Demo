import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileMasterKeyVault } from './file-master-key-vault.js'
import { resolveMasterKey } from './master-key.js'

describe('createFileMasterKeyVault', () => {
  const tempDirs: string[] = []
  const tempKeyPath = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'vynel-file-vault-'))
    tempDirs.push(dir)
    // A nested dir proves store() creates missing parents (the systemd
    // service's data dir may not exist on first boot).
    return join(dir, 'keys', 'master.key')
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('loads null when the file is absent, then round-trips via resolveMasterKey', () => {
    const vault = createFileMasterKeyVault(tempKeyPath())
    expect(vault.load()).toBeNull()
    const minted = resolveMasterKey(vault)
    expect(Buffer.from(minted, 'base64')).toHaveLength(32)
    expect(resolveMasterKey(vault)).toBe(minted)
  })

  it('treats an empty or whitespace-only file as unset', () => {
    const keyPath = tempKeyPath()
    const vault = createFileMasterKeyVault(keyPath)
    vault.store('placeholder')
    writeFileSync(keyPath, '\n  \n')
    expect(vault.load()).toBeNull()
  })

  it('trims the trailing newline store() writes, leaving no staging file', () => {
    const keyPath = tempKeyPath()
    const vault = createFileMasterKeyVault(keyPath)
    vault.store('a-key-value')
    expect(readFileSync(keyPath, 'utf8')).toBe('a-key-value\n')
    expect(vault.load()).toBe('a-key-value')
    expect(existsSync(`${keyPath}.tmp`)).toBe(false)
  })

  it('surfaces non-ENOENT read errors instead of minting a second key', () => {
    // Point the vault at a DIRECTORY — readFileSync fails with EISDIR, which
    // must throw (a silent null would orphan every sealed credential).
    const dir = mkdtempSync(join(tmpdir(), 'vynel-file-vault-'))
    tempDirs.push(dir)
    expect(() => createFileMasterKeyVault(dir).load()).toThrow()
  })
})
