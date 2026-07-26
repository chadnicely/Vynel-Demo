import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseVerifiedNotebook,
  loadVerifiedNotebooksFromDirectory,
  listVerifiedNotebooks,
  findVerifiedNotebookById,
} from './verified-notebooks.js'

const VALID_BOOK = `---
id: test-book
title: A test book
oneLiner: One line about the book.
---

# Heading

Body text.
`

function withTempNotebooksDir<T>(files: Record<string, string>, callback: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-notebooks-'))
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    return callback(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseVerifiedNotebook', () => {
  it('parses frontmatter + body', () => {
    const notebook = parseVerifiedNotebook('test-book.md', VALID_BOOK)
    expect(notebook).toMatchObject({
      id: 'test-book',
      title: 'A test book',
      oneLiner: 'One line about the book.',
    })
    expect(notebook.body).toContain('# Heading')
    expect(notebook.body).not.toContain('---')
  })

  it.each([
    ['no frontmatter block', 'just a body, no frontmatter'],
    ['missing id', '---\ntitle: T\noneLiner: O\n---\nbody'],
    ['missing title', '---\nid: a-b\noneLiner: O\n---\nbody'],
    ['missing oneLiner', '---\nid: a-b\ntitle: T\n---\nbody'],
    ['non-kebab id', '---\nid: Not_Kebab\ntitle: T\noneLiner: O\n---\nbody'],
    ['empty body', '---\nid: a-b\ntitle: T\noneLiner: O\n---\n   '],
  ])('fails loud naming the file: %s', (_reason, content) => {
    expect(() => parseVerifiedNotebook('broken.md', content)).toThrow(/broken\.md.*malformed/)
  })
})

describe('loadVerifiedNotebooksFromDirectory', () => {
  it('loads every .md except README.md, sorted by file name', () => {
    withTempNotebooksDir(
      {
        'b-second.md': VALID_BOOK.replace('test-book', 'b-second'),
        'a-first.md': VALID_BOOK.replace('test-book', 'a-first'),
        'README.md': '# not a book',
        'notes.txt': 'not markdown',
      },
      (dir) => {
        expect(loadVerifiedNotebooksFromDirectory(dir).map((n) => n.id)).toEqual([
          'a-first',
          'b-second',
        ])
      },
    )
  })

  it('throws when two files declare the same id', () => {
    withTempNotebooksDir(
      { 'one.md': VALID_BOOK, 'two.md': VALID_BOOK },
      (dir) => {
        expect(() => loadVerifiedNotebooksFromDirectory(dir)).toThrow(/both declare id "test-book"/)
      },
    )
  })
})

describe('the shipped shelf', () => {
  // test: correct expectation — the shelf grew from two starter books to
  // three with the server-work playbook (ssh module, 2026-07-17).
  it('loads the shipped books', () => {
    const ids = listVerifiedNotebooks().map((n) => n.id)
    expect(ids).toContain('web-app-scaffold')
    expect(ids).toContain('communicating-with-users')
    expect(ids).toContain('working-with-servers')
    expect(ids).toContain('starting-a-project-from-scratch')
    expect(ids).toContain('node-app-scaffold')
    expect(ids).toContain('node-sdk-from-api')
    expect(ids).toContain('vue-nuxt-app-scaffold')
    expect(ids).toContain('node-mcp-server')
    expect(ids).toContain('task-planner')
  })

  it('findVerifiedNotebookById returns the book or null', () => {
    expect(findVerifiedNotebookById('web-app-scaffold')?.title).toBeTruthy()
    expect(findVerifiedNotebookById('no-such-book')).toBeNull()
  })
})
