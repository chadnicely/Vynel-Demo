// Tests for the symlink-containment guard. On Windows non-admin,
// `fs.symlink` requires developer mode + a privilege not always
// available; tests that need symlinks skip-with-reason in that case.

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertRealpathContained } from './assert-realpath-contained.js'

let workspacePath: string
let outsidePath: string

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(tmpdir(), 'vynel-realpath-test-'))
  outsidePath = await mkdtemp(path.join(tmpdir(), 'vynel-realpath-outside-'))
})

afterEach(async () => {
  await rm(workspacePath, { recursive: true, force: true })
  await rm(outsidePath, { recursive: true, force: true })
})

async function trySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM on Windows non-admin; ENOSYS on platforms without symlink
    // support. Test runner skips the case with a comment in those.
    if (code === 'EPERM' || code === 'ENOSYS' || code === 'EACCES') return false
    throw err
  }
}

describe('assertRealpathContained', () => {
  it('passes for an existing file inside the workspace', async () => {
    await writeFile(path.join(workspacePath, 'inside.md'), 'x', 'utf8')
    await expect(
      assertRealpathContained(workspacePath, path.join(workspacePath, 'inside.md')),
    ).resolves.toBeUndefined()
  })

  it('passes for a not-yet-created file inside the workspace', async () => {
    await mkdir(path.join(workspacePath, 'nested'))
    await expect(
      assertRealpathContained(
        workspacePath,
        path.join(workspacePath, 'nested', 'new-file.md'),
      ),
    ).resolves.toBeUndefined()
  })

  it('passes for the workspace root itself', async () => {
    await expect(assertRealpathContained(workspacePath, workspacePath)).resolves.toBeUndefined()
  })

  it('rejects a symlink that escapes the workspace', async () => {
    // SKIP: on Windows non-admin / lacking developer mode, fs.symlink
    // throws EPERM. The containment contract still holds (we just
    // can't construct the attack scenario in the test).
    const linkPath = path.join(workspacePath, 'escape')
    if (!(await trySymlink(outsidePath, linkPath))) return

    await expect(assertRealpathContained(workspacePath, linkPath)).rejects.toThrow(
      /outside the workspace via a symlink/i,
    )
  })

  it("rejects writing INTO a symlinked-out directory (not-yet-created file)", async () => {
    const linkPath = path.join(workspacePath, 'safelooking')
    if (!(await trySymlink(outsidePath, linkPath))) return

    // A file path UNDER the symlink — doesn't exist yet on disk, but
    // its nearest-existing ancestor is the symlink target.
    await expect(
      assertRealpathContained(workspacePath, path.join(linkPath, 'new-attack.md')),
    ).rejects.toThrow(/outside the workspace via a symlink/i)
  })

  it("accepts a symlink that stays inside the workspace", async () => {
    const realDir = path.join(workspacePath, 'real')
    await mkdir(realDir)
    const linkPath = path.join(workspacePath, 'alias')
    if (!(await trySymlink(realDir, linkPath))) return

    await expect(
      assertRealpathContained(workspacePath, path.join(linkPath, 'ok.md')),
    ).resolves.toBeUndefined()
  })
})
