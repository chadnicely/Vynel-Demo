// Public surface of the `@vynel/files` domain package.

export type {
  FileActivity,
  NewFileActivity,
  FileActivityKind,
  FileActivityEditor,
  StructuralLogger,
  ResolvedWorkspacePath,
} from './files-types.js'

export type { FileContentKind, FileContent, FileActivityCursor } from './files-types.js'

export { resolveWorkspaceRelativePath } from './resolve-workspace-relative-path.js'
export { assertRealpathContained } from './assert-realpath-contained.js'

export {
  MAX_EDITABLE_BYTES,
  deriveFileContentKind,
  isTextKind,
  contentTypeForRawResponse,
} from './file-content-kind.js'
export { isHiddenEntry, isUnderHiddenFolder, assertWritableTarget } from './path-safety.js'

export { listDirectory } from './list-directory.js'
export type { DirectoryEntry, DirectoryEntryKind, ListDirectoryInput } from './list-directory.js'

export { readFileContent } from './read-file-content.js'
export type { ReadFileContentInput } from './read-file-content.js'

export { streamFileBytes } from './stream-file-bytes.js'
export type { StreamFileBytesInput, StreamFileBytesOutput } from './stream-file-bytes.js'

export { writeFileContent } from './write-file-content.js'
export type { WriteFileContentInput, WriteFileContentResult } from './write-file-content.js'

export { createFile } from './create-file.js'
export type { CreateFileInput } from './create-file.js'

export { createDirectory } from './create-directory.js'
export type { CreateDirectoryInput } from './create-directory.js'

export { moveEntry } from './move-entry.js'
export type { MoveEntryInput } from './move-entry.js'

export { deleteEntry } from './delete-entry.js'
export type { DeleteEntryInput } from './delete-entry.js'

export { listRecentActivity } from './list-recent-activity.js'
export type {
  ListRecentActivityInput,
  ListRecentActivityResult,
} from './list-recent-activity.js'

export { listFileHistory } from './list-file-history.js'
export type { ListFileHistoryInput, ListFileHistoryResult } from './list-file-history.js'

export { purgeOldFileActivities } from './purge-old-file-activities.js'
export type { PurgeOldFileActivitiesResult } from './purge-old-file-activities.js'

export { FilesFileWatcherService } from './file-watcher.js'
export type { WorkspaceWatchInput, FilesFileWatcherOptions } from './file-watcher.js'
