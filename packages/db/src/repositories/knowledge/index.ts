// Barrel for the `knowledge` domain repositories. Created because
// the domain has ≥3 sibling repos (documents + chunks + search) —
// per structure-standard.md "Barrels".
//
// Flat re-export pattern matching the corpus convention (memory /
// chat / approvals / workspaces / skills). Function names carry an
// entity prefix (e.g. `findDocumentByPath`, `insertChunks`) so the
// flat surface stays unambiguous after the three modules merge.

export * from './documents.js'
export * from './chunks.js'
export * from './search.js'
