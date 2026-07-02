// Tests for the content-kind + MIME derivation — pure, no fs, no db.

import { describe, expect, it } from 'vitest'
import {
  MAX_EDITABLE_BYTES,
  contentTypeForRawResponse,
  deriveFileContentKind,
  isTextKind,
} from './file-content-kind.js'

describe('MAX_EDITABLE_BYTES', () => {
  it('is 1 MiB per D12', () => {
    expect(MAX_EDITABLE_BYTES).toBe(1024 * 1024)
  })
})

describe('deriveFileContentKind', () => {
  it.each([
    ['notes/todo.md', 'markdown'],
    ['readme.MARKDOWN', 'markdown'],
    ['picture.png', 'image'],
    ['logo.SVG', 'image'],
    ['photo.jpg', 'image'],
    ['photo.jpeg', 'image'],
    ['document.pdf', 'pdf'],
    ['report.docx', 'unsupported'],
    ['archive.zip', 'unsupported'],
    ['notes/budget.csv', 'plain-text'],
    ['config.json', 'plain-text'],
    ['index.html', 'plain-text'],
    ['main.ts', 'plain-text'],
    ['plain.txt', 'plain-text'],
    ['no-extension', 'plain-text'],
  ] as const)('%s → %s', (input, expected) => {
    expect(deriveFileContentKind(input)).toBe(expected)
  })
})

describe('isTextKind', () => {
  it('markdown + plain-text are text; others are not', () => {
    expect(isTextKind('markdown')).toBe(true)
    expect(isTextKind('plain-text')).toBe(true)
    expect(isTextKind('image')).toBe(false)
    expect(isTextKind('pdf')).toBe(false)
    expect(isTextKind('unsupported')).toBe(false)
  })
})

describe('contentTypeForRawResponse', () => {
  it.each([
    ['notes.md', 'text/markdown; charset=utf-8'],
    ['budget.csv', 'text/plain; charset=utf-8'],
    ['logo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['icon.gif', 'image/gif'],
    ['icon.webp', 'image/webp'],
    ['icon.svg', 'image/svg+xml'],
    ['favicon.ico', 'image/x-icon'],
    ['fig.bmp', 'image/bmp'],
    ['report.pdf', 'application/pdf'],
    ['archive.zip', 'application/octet-stream'],
    ['mystery', 'text/plain; charset=utf-8'],
  ] as const)('%s → %s', (input, expected) => {
    expect(contentTypeForRawResponse(input)).toBe(expected)
  })
})
