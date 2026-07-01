// `@vynel/indexer` — pure helpers for the `knowledge` domain.
// Parsers (markdown, plain-text, pdf, docx, html, csv, json) +
// recursive-character chunker. NO `db`, NO repos, NO cross-domain
// imports. Orchestration lives in the `@vynel/knowledge` feature package
// (per the locked decision file
// `infra-package-pure-helpers-core-package-orchestration`).

export * from './parsers/index.js'
export * from './chunking/chunk-parsed-text.js'
