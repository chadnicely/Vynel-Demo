// The real extractor against real archives — the fixtures were built once
// with GNU tar + bzip2 (a 10 KB tar, 216 bytes compressed). The bz2 test is
// the regression pin for the QC field failure: Windows' bundled bsdtar is
// often built without libbz2 ("unable to run program 'bzip2 -d'"), so the
// bzip2 layer must never reach the system tar.

import { describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractArchive } from './extract-archive.js'

const fixturesDir = fileURLToPath(new URL('./test-support/fixtures', import.meta.url))

async function inTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'vynel-extract-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('extractArchive', () => {
  it('extracts a .tar.bz2 without ever handing bzip2 to the system tar', async () => {
    await inTempDir(async (dir) => {
      await copyFile(join(fixturesDir, 'sample.tar.bz2'), join(dir, 'sample.tar.bz2'))

      await extractArchive('sample.tar.bz2', dir)

      expect(await readFile(join(dir, 'sample-model', 'tokens.txt'), 'utf8')).toBe('hello tokens\n')
      expect(await readFile(join(dir, 'sample-model', 'model.onnx'), 'utf8')).toBe('onnx-bytes')
      // No intermediates left for the caller to trip on: the compressed
      // original and the decompressed .tar are both gone.
      expect((await readdir(dir)).sort()).toEqual(['sample-model'])
    })
  })

  it('a truncated .tar.bz2 rejects loudly — no half-extracted model appears', async () => {
    await inTempDir(async (dir) => {
      // The failure class this module exists for: a download cut mid-stream on
      // a user machine. Half the fixture is enough header to start decoding
      // and not enough to finish.
      const whole = await readFile(join(fixturesDir, 'sample.tar.bz2'))
      await writeFile(join(dir, 'sample.tar.bz2'), whole.subarray(0, Math.floor(whole.length / 2)))

      await expect(extractArchive('sample.tar.bz2', dir)).rejects.toThrow()

      const leftovers = await readdir(dir)
      // Nothing extractable ever reached tar — no model folder to mistake for
      // an install (the caller's staging-dir wipe removes the partials).
      expect(leftovers).not.toContain('sample-model')
    })
  })

  it('still extracts a plain .tar through the system tar untouched', async () => {
    await inTempDir(async (dir) => {
      await copyFile(join(fixturesDir, 'sample.tar'), join(dir, 'sample.tar'))

      await extractArchive('sample.tar', dir)

      expect(await readFile(join(dir, 'sample-model', 'tokens.txt'), 'utf8')).toBe('hello tokens\n')
      // A caller-owned archive name is left for the caller to clean up —
      // exactly the pre-fix contract.
      expect((await readdir(dir)).sort()).toEqual(['sample-model', 'sample.tar'])
    })
  })
})
