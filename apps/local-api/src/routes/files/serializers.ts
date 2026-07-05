// Response serializers for `files` HTTP routes. Date columns emit as
// ISO strings; the `editor` discriminator passes through (UI uses it
// to phrase the actor — D16 + blueprint §11.1).

import type { z } from 'zod'
import type { FileActivity } from '@vynel/db/repositories/files'
import type { DirectoryEntry, FileContent } from '@vynel/files'
import type {
  DirectoryEntrySchema,
  FileContentSchema,
  FileActivitySchema,
  FileMetadataSchema,
} from './schemas.js'

export type SerializedDirectoryEntry = z.infer<typeof DirectoryEntrySchema>

export function serializeDirectoryEntry(entry: DirectoryEntry): SerializedDirectoryEntry {
  return {
    name: entry.name,
    kind: entry.kind,
    relativePath: entry.relativePath,
    fileSizeBytes: entry.fileSizeBytes,
    modifiedAt: entry.modifiedAt.toISOString(),
    childCount: entry.childCount,
  }
}

export type SerializedFileContent = z.infer<typeof FileContentSchema>

export function serializeFileContent(content: FileContent): SerializedFileContent {
  return {
    relativePath: content.relativePath,
    kind: content.kind,
    isText: content.isText,
    content: content.content,
    fileSizeBytes: content.fileSizeBytes,
    modifiedAt: content.modifiedAt.toISOString(),
    isTruncated: content.isTruncated,
  }
}

export type SerializedFileActivity = z.infer<typeof FileActivitySchema>

export function serializeFileActivity(activity: FileActivity): SerializedFileActivity {
  return {
    id: activity.id,
    userId: activity.userId,
    workspaceId: activity.workspaceId,
    activityKind: activity.activityKind,
    editor: activity.editor,
    relativePath: activity.relativePath,
    fromPath: activity.fromPath,
    fileSizeBytes: activity.fileSizeBytes,
    occurredAt: activity.occurredAt.toISOString(),
  }
}

export type SerializedFileMetadata = z.infer<typeof FileMetadataSchema>

export function serializeFileMetadata(input: {
  relativePath: string
  fileSizeBytes: number
  modifiedAt: Date
}): SerializedFileMetadata {
  return {
    relativePath: input.relativePath,
    fileSizeBytes: input.fileSizeBytes,
    modifiedAt: input.modifiedAt.toISOString(),
  }
}
