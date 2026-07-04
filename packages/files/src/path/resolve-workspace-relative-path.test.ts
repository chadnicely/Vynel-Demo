// The security floor for the files domain. This matrix is mandatory.
// code-reviewer treats a missing case as Critical-tier (same level as
// a missing soft-delete filter).
//
// Cases:
//   1. NUL byte             -> ValidationError
//   2. Absolute POSIX path  -> ValidationError
//   3. Absolute Windows path-> ValidationError (on Windows; treated as
//                              literal name on POSIX, contained inside
//                              the workspace)
//   4. `..` escape          -> ValidationError
//   5. Deep `..` escape     -> ValidationError
//   6. Backslash on input   -> Windows: separator + escape detected;
//                              POSIX: literal filename, contained
//   7. Valid nested path    -> resolved + normalized
//   8. Empty string (root)  -> resolves to workspace root itself
//   9. Trailing slash       -> normalized
//  10. Current-dir refs `.` -> normalized away

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRelativePath } from './resolve-workspace-relative-path.js'

const WORKSPACE = path.resolve('/tmp/vynel/ws-a')
const NUL = String.fromCharCode(0)

describe('resolveWorkspaceRelativePath', () => {
  describe('rejects path-traversal inputs', () => {
    it('rejects a NUL byte (U+0000) anywhere in the path', () => {
      expect(() => resolveWorkspaceRelativePath(WORKSPACE, `notes${NUL}.md`)).toThrow(
        /not valid|invalid/i,
      )
    })

    it('rejects an absolute POSIX path', () => {
      expect(() => resolveWorkspaceRelativePath(WORKSPACE, '/etc/passwd')).toThrow(
        /inside the workspace|absolute/i,
      )
    })

    it('rejects an absolute Windows path on Windows; treats it as a literal name on POSIX', () => {
      if (process.platform === 'win32') {
        expect(() => resolveWorkspaceRelativePath(WORKSPACE, 'C:\\Windows\\System32')).toThrow(
          /inside the workspace|absolute|outside/i,
        )
      } else {
        // On POSIX, `C:\Windows\System32` is a strange but legal filename.
        // Containment still holds — that's the only safety contract.
        const { normalizedRelativePath } = resolveWorkspaceRelativePath(
          WORKSPACE,
          'C:\\Windows\\System32',
        )
        expect(normalizedRelativePath).toBe('C:\\Windows\\System32')
      }
    })

    it('rejects a single `..` escape', () => {
      expect(() => resolveWorkspaceRelativePath(WORKSPACE, '../escape.txt')).toThrow(
        /outside the workspace/i,
      )
    })

    it('rejects a deep `..` escape', () => {
      expect(() => resolveWorkspaceRelativePath(WORKSPACE, '../../../../../etc/passwd')).toThrow(
        /outside the workspace/i,
      )
    })

    it('rejects mixed `..` segments that escape', () => {
      expect(() =>
        resolveWorkspaceRelativePath(WORKSPACE, 'notes/../../secrets/passwd'),
      ).toThrow(/outside the workspace/i)
    })

    it('handles backslash separators per platform (Windows: escape detected; POSIX: literal name + contained)', () => {
      if (process.platform === 'win32') {
        expect(() => resolveWorkspaceRelativePath(WORKSPACE, '..\\..\\secrets')).toThrow(
          /outside the workspace/i,
        )
      } else {
        const { normalizedRelativePath } = resolveWorkspaceRelativePath(
          WORKSPACE,
          '..\\..\\secrets',
        )
        // Whole input is one literal filename on POSIX — contained.
        expect(normalizedRelativePath).toBe('..\\..\\secrets')
      }
    })

    it('rejects a sibling-of-root attack (`${root}-sibling`-shaped escape)', () => {
      // Naive startsWith(root) without the `+ sep` predicate would pass
      // `${root}-sibling/secret` — the `+ sep` guard catches it.
      // We craft an escape that resolves to root's parent + a sibling
      // dir name. On POSIX with root `/tmp/vynel/ws-a`, this resolves
      // to `/tmp/vynel/ws-a-sibling` -> outside.
      // We use the `..` form which path.resolve normalizes:
      expect(() =>
        resolveWorkspaceRelativePath(WORKSPACE, '../' + path.basename(WORKSPACE) + '-sibling'),
      ).toThrow(/outside the workspace/i)
    })
  })

  describe('accepts valid paths', () => {
    it('resolves a simple nested path', () => {
      const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
        WORKSPACE,
        'notes/todo.md',
      )
      expect(absolutePath).toBe(path.join(WORKSPACE, 'notes', 'todo.md'))
      expect(normalizedRelativePath).toBe('notes/todo.md')
    })

    it('accepts the empty string as the workspace root itself', () => {
      const { absolutePath, normalizedRelativePath } = resolveWorkspaceRelativePath(
        WORKSPACE,
        '',
      )
      expect(absolutePath).toBe(WORKSPACE)
      expect(normalizedRelativePath).toBe('')
    })

    it('normalizes trailing slashes + current-dir segments', () => {
      const { normalizedRelativePath } = resolveWorkspaceRelativePath(
        WORKSPACE,
        './notes/./todo.md/',
      )
      expect(normalizedRelativePath).toBe('notes/todo.md')
    })

    it('returns forward-slash normalized paths regardless of input separator', () => {
      const input = ['a', 'b', 'c.txt'].join(path.sep)
      const { normalizedRelativePath } = resolveWorkspaceRelativePath(WORKSPACE, input)
      expect(normalizedRelativePath).toBe('a/b/c.txt')
    })
  })
})
