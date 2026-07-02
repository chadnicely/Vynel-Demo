// Public surface for the `knowledge` domain core layer.
//
// Consumers import via the per-domain subpath:
//   import { indexFile, searchKnowledge, FileWatcherService } from '@vynel/knowledge'
//
// Per-operation files are TDD'd in /build-domain (Gate 2 = test
// before implementing). The barrel grows during Implement as each
// op lands.

export * from './knowledge-types.js'
export * from './knowledge-events.js'
export * from './indexing/content-hash.js'
export * from './indexing/index-file.js'
export * from './indexing/index-workspace.js'
export * from './indexing/remove-file-from-index.js'
export * from './indexing/force-reindex-workspace.js'
export * from './queries/search-knowledge.js'
export * from './queries/list-documents-for-workspace.js'
export * from './queries/get-document-detail.js'
export * from './queries/get-indexer-status.js'
export * from './indexing/generate-knowledge-embeddings.js'
export * from './indexing/file-watcher.js'
export * from './lifecycle/handle-workspace-created.js'
export * from './lifecycle/handle-workspace-removed.js'
export * from './sources/path-safety.js'
export * from './sources/register-knowledge-source.js'
export * from './sources/remove-knowledge-source.js'
export * from './sources/list-knowledge-sources.js'
