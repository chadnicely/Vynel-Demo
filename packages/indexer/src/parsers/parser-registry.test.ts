// Tests for the parser registry.

import { describe, expect, it } from 'vitest'
import { resolveDocumentParser, deriveDocumentKindFromPath } from './parser-registry.js'
import { parseMarkdownDocument } from './parse-markdown.js'
import { parsePdfDocument } from './parse-pdf.js'

describe('parser-registry', () => {
  describe('deriveDocumentKindFromPath', () => {
    it('returns markdown for .md / .markdown', () => {
      expect(deriveDocumentKindFromPath('a.md')).toBe('markdown')
      expect(deriveDocumentKindFromPath('A.markdown')).toBe('markdown')
    })
    it('returns plain-text for .txt', () => {
      expect(deriveDocumentKindFromPath('notes.txt')).toBe('plain-text')
    })
    it('returns pdf for .pdf', () => {
      expect(deriveDocumentKindFromPath('contract.pdf')).toBe('pdf')
    })
    it('returns docx for .docx', () => {
      expect(deriveDocumentKindFromPath('report.docx')).toBe('docx')
    })
    it('returns html for .html / .htm', () => {
      expect(deriveDocumentKindFromPath('index.html')).toBe('html')
      expect(deriveDocumentKindFromPath('index.htm')).toBe('html')
    })
    it('returns csv for .csv / .tsv', () => {
      expect(deriveDocumentKindFromPath('rows.csv')).toBe('csv')
      expect(deriveDocumentKindFromPath('rows.tsv')).toBe('csv')
    })
    it('returns json for .json', () => {
      expect(deriveDocumentKindFromPath('config.json')).toBe('json')
    })
    it('returns unsupported for unknown extensions', () => {
      expect(deriveDocumentKindFromPath('image.png')).toBe('unsupported')
      expect(deriveDocumentKindFromPath('binary')).toBe('unsupported')
    })
    it('is case-insensitive on the extension', () => {
      expect(deriveDocumentKindFromPath('Contract.PDF')).toBe('pdf')
      expect(deriveDocumentKindFromPath('NOTES.MD')).toBe('markdown')
    })
  })

  describe('resolveDocumentParser', () => {
    it('returns null for unsupported kind', () => {
      expect(resolveDocumentParser('unsupported')).toBeNull()
    })
    it('returns the correct parser for each supported kind', () => {
      expect(resolveDocumentParser('markdown')).toBe(parseMarkdownDocument)
      expect(resolveDocumentParser('pdf')).toBe(parsePdfDocument)
      // Other kinds resolve to non-null parsers (identity not checked exhaustively)
      expect(resolveDocumentParser('plain-text')).not.toBeNull()
      expect(resolveDocumentParser('docx')).not.toBeNull()
      expect(resolveDocumentParser('html')).not.toBeNull()
      expect(resolveDocumentParser('csv')).not.toBeNull()
      expect(resolveDocumentParser('json')).not.toBeNull()
    })
  })
})
