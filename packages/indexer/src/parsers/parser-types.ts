// Parser contract for the `@vynel/indexer` package. Every concrete
// `parseXxxDocument` function (markdown, plain-text, pdf, docx,
// html, csv, json) implements `DocumentParser`. The registry resolves
// one by extension.
//
// Per D24: this package holds PURE helpers only — no `db`, no repo
// imports, no cross-domain calls. Parsers read a file path and
// return parsed text + optional metadata. Orchestration (indexFile,
// FileWatcherService, etc.) lives in the `@vynel/knowledge` package.
//
// See `docs/blueprints/knowledge/blueprint.md §4.1` + `coding.md §3`.

export type DocumentKind =
  | 'markdown'
  | 'plain-text'
  | 'pdf'
  | 'docx'
  | 'html'
  | 'csv'
  | 'json'
  | 'unsupported'

export type ParseDocumentInput = {
  absolutePath: string
  fileSizeBytes: number
}

export type ParseDocumentResult = {
  parsedText: string
  pageCount?: number // PDF
  sheetCount?: number // future XLSX
}

export type DocumentParser = (input: ParseDocumentInput) => Promise<ParseDocumentResult>
