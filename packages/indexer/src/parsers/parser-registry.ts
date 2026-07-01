// Parser registry — resolves a DocumentKind to its parser and
// derives DocumentKind from a file extension.
//
// Adding a new format is a multi-file edit: extend the DocumentKind
// union, add the parser file, add the registry entry, add the
// extension mapping.
//
// Per blueprint §4.8 + coding.md §3.

import path from 'node:path'
import type { DocumentKind, DocumentParser } from './parser-types.js'
import { parseMarkdownDocument } from './parse-markdown.js'
import { parsePlainTextDocument } from './parse-plain-text.js'
import { parsePdfDocument } from './parse-pdf.js'
import { parseDocxDocument } from './parse-docx.js'
import { parseHtmlDocument } from './parse-html.js'
import { parseCsvDocument } from './parse-csv.js'
import { parseJsonDocument } from './parse-json.js'

const PARSERS_BY_DOCUMENT_KIND: Record<Exclude<DocumentKind, 'unsupported'>, DocumentParser> = {
  markdown: parseMarkdownDocument,
  'plain-text': parsePlainTextDocument,
  pdf: parsePdfDocument,
  docx: parseDocxDocument,
  html: parseHtmlDocument,
  csv: parseCsvDocument,
  json: parseJsonDocument,
}

export function resolveDocumentParser(documentKind: DocumentKind): DocumentParser | null {
  if (documentKind === 'unsupported') return null
  return PARSERS_BY_DOCUMENT_KIND[documentKind]
}

export function deriveDocumentKindFromPath(relativePath: string): DocumentKind {
  const ext = path.extname(relativePath).toLowerCase()
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown'
    case '.txt':
      return 'plain-text'
    case '.pdf':
      return 'pdf'
    case '.docx':
      return 'docx'
    case '.html':
    case '.htm':
      return 'html'
    case '.csv':
    case '.tsv':
      return 'csv'
    case '.json':
      return 'json'
    default:
      return 'unsupported'
  }
}
