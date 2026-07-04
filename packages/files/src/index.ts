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

export { resolveWorkspaceRelativePath } from './path/resolve-workspace-relative-path.js'
export { assertRealpathContained } from './path/assert-realpath-contained.js'

export {
  MAX_EDITABLE_BYTES,
  deriveFileContentKind,
  isTextKind,
  contentTypeForRawResponse,
} from './operations/file-content-kind.js'
export { isHiddenEntry, isUnderHiddenFolder, assertWritableTarget } from './path/path-safety.js'

export { listDirectory } from './operations/list-directory.js'
export type { DirectoryEntry, DirectoryEntryKind, ListDirectoryInput } from './operations/list-directory.js'

export { readFileContent } from './operations/read-file-content.js'
export type { ReadFileContentInput } from './operations/read-file-content.js'

export { streamFileBytes } from './operations/stream-file-bytes.js'
export type { StreamFileBytesInput, StreamFileBytesOutput } from './operations/stream-file-bytes.js'

export { writeFileContent } from './operations/write-file-content.js'
export type { WriteFileContentInput, WriteFileContentResult } from './operations/write-file-content.js'

export { createFile } from './operations/create-file.js'
export type { CreateFileInput } from './operations/create-file.js'

export { createDirectory } from './operations/create-directory.js'
export type { CreateDirectoryInput } from './operations/create-directory.js'

export { moveEntry } from './operations/move-entry.js'
export type { MoveEntryInput } from './operations/move-entry.js'

export { deleteEntry } from './operations/delete-entry.js'
export type { DeleteEntryInput } from './operations/delete-entry.js'

export { listRecentActivity } from './activity/list-recent-activity.js'
export type {
  ListRecentActivityInput,
  ListRecentActivityResult,
} from './activity/list-recent-activity.js'

export { listFileHistory } from './activity/list-file-history.js'
export type { ListFileHistoryInput, ListFileHistoryResult } from './activity/list-file-history.js'

export { purgeOldFileActivities } from './activity/purge-old-file-activities.js'
export type { PurgeOldFileActivitiesResult } from './activity/purge-old-file-activities.js'

export { FilesFileWatcherService } from './file-watcher.js'
export type { WorkspaceWatchInput, FilesFileWatcherOptions } from './file-watcher.js'
