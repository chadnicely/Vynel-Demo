// Outbox event type constants + payload interfaces for the `knowledge`
// domain. Three lifecycle events (`-indexed`, `-updated`, `-removed`).
//
// Each event row is co-committed in the same transaction as the
// state change via the `_shared/outbox` infra workspaces shipped.
//
// (Pre-A2 a fourth `workspace-file-changed` "reconcile seam" event fed
// memory from identity files; identity files are retired — A2 — so it
// was removed.)
//
// See `docs/blueprints/knowledge/blueprint.md §11`.

export const KNOWLEDGE_DOCUMENT_INDEXED = 'knowledge.document-indexed' as const
export const KNOWLEDGE_DOCUMENT_UPDATED = 'knowledge.document-updated' as const
export const KNOWLEDGE_DOCUMENT_REMOVED = 'knowledge.document-removed' as const

export type KnowledgeDocumentIndexedPayload = {
  // Null for a global-scope document (no workspace).
  workspaceId: string | null
  userId: string
  documentId: string
  relativePath: string
  documentKind: 'markdown' | 'plain-text' | 'pdf' | 'docx' | 'html' | 'csv' | 'json' | 'unsupported'
  chunkCount: number
}

// document-updated and document-indexed share the same payload shape;
// the topic distinguishes "new" vs "existing-re-indexed-with-new-hash".
export type KnowledgeDocumentUpdatedPayload = KnowledgeDocumentIndexedPayload

export type KnowledgeDocumentRemovedPayload = {
  workspaceId: string | null
  userId: string
  documentId: string
  relativePath: string
}
