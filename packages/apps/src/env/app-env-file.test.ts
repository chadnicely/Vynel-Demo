import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAppEnvFile, writeAppEnvFile, resolveAppEnvFilePath } from './app-env-file.js'

function withTempWorkspace(run: (workspacePath: string) => void): void {
  const workspacePath = mkdtempSync(join(tmpdir(), 'vynel-app-env-'))
  try {
    run(workspacePath)
  } finally {
    rmSync(workspacePath, { recursive: true, force: true })
  }
}

describe('resolveAppEnvFilePath', () => {
  it('resolves inside the workspace (root and subfolder apps)', () => {
    withTempWorkspace((workspacePath) => {
      expect(
        resolveAppEnvFilePath({ workspacePath, cwdRelative: '', envFileRelative: '.env' }),
      ).toBe(join(workspacePath, '.env'))
      expect(
        resolveAppEnvFilePath({
          workspacePath,
          cwdRelative: 'apps/web',
          envFileRelative: '.env.local',
        }),
      ).toBe(join(workspacePath, 'apps', 'web', '.env.local'))
    })
  })

  it('returns null for an escaping path', () => {
    withTempWorkspace((workspacePath) => {
      expect(
        resolveAppEnvFilePath({
          workspacePath,
          cwdRelative: 'apps/web',
          envFileRelative: '../../../outside/.env',
        }),
      ).toBeNull()
    })
  })
})

describe('readAppEnvFile / writeAppEnvFile', () => {
  it('reads a missing file as exists:false and an existing one into entries', () => {
    withTempWorkspace((workspacePath) => {
      const ref = { workspacePath, cwdRelative: '', envFileRelative: '.env' }
      expect(readAppEnvFile(ref)).toEqual({ exists: false, entries: [] })

      writeFileSync(join(workspacePath, '.env'), '# db\nDATABASE_URL=dev\n')
      expect(readAppEnvFile(ref)).toEqual({
        exists: true,
        entries: [{ key: 'DATABASE_URL', value: 'dev' }],
      })
    })
  })

  it('writes line-preservingly: comments survive, removed keys go, new keys append', () => {
    withTempWorkspace((workspacePath) => {
      const ref = { workspacePath, cwdRelative: '', envFileRelative: '.env' }
      writeFileSync(join(workspacePath, '.env'), '# db\nDATABASE_URL=dev\nGONE=x\n')

      const entries = writeAppEnvFile(ref, [
        { key: 'DATABASE_URL', value: 'prod' },
        { key: 'API_KEY', value: 'abc' },
      ])
      expect(entries).toEqual([
        { key: 'DATABASE_URL', value: 'prod' },
        { key: 'API_KEY', value: 'abc' },
      ])
      expect(readFileSync(join(workspacePath, '.env'), 'utf8')).toBe(
        '# db\nDATABASE_URL=prod\nAPI_KEY=abc\n',
      )
    })
  })

  it('creates the file when missing (folder exists)', () => {
    withTempWorkspace((workspacePath) => {
      mkdirSync(join(workspacePath, 'apps', 'web'), { recursive: true })
      const ref = { workspacePath, cwdRelative: 'apps/web', envFileRelative: '.env' }
      writeAppEnvFile(ref, [{ key: 'PORT', value: '3000' }])
      expect(readFileSync(join(workspacePath, 'apps', 'web', '.env'), 'utf8')).toBe('PORT=3000\n')
    })
  })

  it('rejects escapes, a missing app folder, and invalid entries (taxonomy-free)', () => {
    withTempWorkspace((workspacePath) => {
      expect(() =>
        readAppEnvFile({ workspacePath, cwdRelative: '', envFileRelative: '../.env' }),
      ).toThrow('app_env_escapes_workspace')
      expect(() =>
        writeAppEnvFile({ workspacePath, cwdRelative: 'missing/folder', envFileRelative: '.env' }, []),
      ).toThrow('app_env_folder_missing')

      const ref = { workspacePath, cwdRelative: '', envFileRelative: '.env' }
      expect(() => writeAppEnvFile(ref, [{ key: '1BAD', value: 'x' }])).toThrow(
        'app_env_invalid_key',
      )
      // A file holding a multi-line quoted value refuses ANY edit — a
      // line-based rewrite would fragment the secret.
      writeFileSync(join(workspacePath, '.env'), 'CERT="-----BEGIN\nabc\n-----END"\n')
      expect(() => writeAppEnvFile(ref, [{ key: 'A', value: '1' }])).toThrow(
        'app_env_multiline_file',
      )
      rmSync(join(workspacePath, '.env'))
      expect(() => writeAppEnvFile(ref, [{ key: 'A', value: 'x\ny' }])).toThrow(
        'app_env_multiline_value',
      )
      expect(() =>
        writeAppEnvFile(ref, [
          { key: 'A', value: '1' },
          { key: 'A', value: '2' },
        ]),
      ).toThrow('app_env_duplicate_key')
    })
  })
})
