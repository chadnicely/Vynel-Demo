// Response serializer for `notebook` routes. Converts an
// `InstructionDocument` DB row to the JSON shape the SDK consumer sees
// (dates → ISO strings), per the memory/knowledge serializers precedent.
// Playbook shelf entries (`listPlaybooks` / `findPlaybookById`) are already
// plain serializable objects — they pass through unserialized in `index.ts`.

import type { z } from 'zod'
import type { InstructionDocument } from '@vynel/instructions'
import { NotebookDocumentSchema } from './schemas.js'

export type SerializedNotebookDocument = z.infer<typeof NotebookDocumentSchema>

export function serializeNotebookDocument(
  document: InstructionDocument,
): SerializedNotebookDocument {
  return {
    id: document.id,
    userId: document.userId,
    scope: document.scope,
    workspaceId: document.workspaceId,
    mode: document.mode,
    title: document.title,
    body: document.body,
    enabled: document.enabled,
    sortOrder: document.sortOrder,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  }
}
