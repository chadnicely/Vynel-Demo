// Public surface of the `@vynel/instructions` package — user-authored
// guidance documents (notebook-mode in this slice) + the verified notebook
// shelf + the `vynel-notebook` MCP feature descriptor.

export type {
  InstructionDocument,
  NewInstructionDocument,
  InstructionScope,
  InstructionMode,
} from './schema/index.js'

export {
  INSTRUCTION_CREATED,
  INSTRUCTION_UPDATED,
  INSTRUCTION_DELETED,
} from './instructions-events.js'
export type {
  InstructionCreatedPayload,
  InstructionUpdatedPayload,
  InstructionDeletedPayload,
} from './instructions-events.js'

// Write ops (UI-only callers — the model is read-only on the notebook)
export {
  createInstructionDocument,
  type CreateInstructionDocumentInput,
} from './lifecycle/create-instruction-document.js'
export {
  updateInstructionDocument,
  type UpdateInstructionDocumentInput,
} from './lifecycle/update-instruction-document.js'
export { deleteInstructionDocument } from './lifecycle/delete-instruction-document.js'

// Read ops
export {
  listInstructionDocuments,
  type ListInstructionDocumentsInput,
} from './queries/list-instruction-documents.js'

// The verified shelf (repo-shipped, immutable)
export {
  listVerifiedNotebooks,
  findVerifiedNotebookById,
  type VerifiedNotebook,
} from './notebooks/verified-notebooks.js'

// The MCP attachment (read-only list/read tools + the standing prompt line)
export {
  notebookFeatureDescriptor,
  NOTEBOOK_PROMPT_INSTRUCTIONS,
} from './mcp/notebook-mcp-feature-descriptor.js'
