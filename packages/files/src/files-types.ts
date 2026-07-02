// Domain types for the `files` domain. Re-exports the row types from
// the schema layer + the domain-only types used by core ops and the
// HTTP layer.

export type {
  FileActivity,
  NewFileActivity,
  FileActivityKind,
  FileActivityEditor,
} from '@vynel/db/schema/files'

// Structural-logger shape: core ops accept `{ info, warn }` directly so
// `@vynel/logger` is not a hard dep. Apps wire pino at the boundary.
export type StructuralLogger = {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
}

// Path-safety helper output. `absolutePath` is OS-native;
// `normalizedRelativePath` is forward-slash, workspace-relative.
export type ResolvedWorkspacePath = {
  absolutePath: string
  normalizedRelativePath: string
}

// File-content render kind for the UI. Narrower than
// @vynel/indexer's DocumentKind because the files preview surface is
// a small set of render strategies (MarkdownRenderer / <img> / <object>
// / <pre> / EmptyState+download).
export type FileContentKind = 'markdown' | 'plain-text' | 'image' | 'pdf' | 'unsupported'

// The shape returned by readFileContent. Binary kinds omit `content`
// (the UI fetches bytes via /raw); text kinds set `isText: true` and
// truncate at MAX_EDITABLE_BYTES.
export interface FileContent {
  relativePath: string
  kind: FileContentKind
  isText: boolean
  content: string | null
  fileSizeBytes: number
  modifiedAt: Date
  isTruncated: boolean
}

// Cursor envelope for activity feeds. ISO over the wire;
// converted to Date at the core boundary.
export interface FileActivityCursor {
  occurredAt: string
  id: string
}
