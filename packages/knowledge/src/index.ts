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
export * from './content-hash.js'
export * from './index-file.js'
export * from './index-workspace.js'
export * from './remove-file-from-index.js'
export * from './force-reindex-workspace.js'
export * from './search-knowledge.js'
export * from './list-documents-for-workspace.js'
export * from './get-document-detail.js'
export * from './get-indexer-status.js'
export * from './generate-knowledge-embeddings.js'
export * from './file-watcher.js'
export * from './handle-workspace-created.js'
export * from './handle-workspace-removed.js'
