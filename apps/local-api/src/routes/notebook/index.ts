// The USER-scoped `notebook` HTTP surface — mounted at `/notebook` (no
// workspace prefix) from `apps/local-api/src/app.ts`:
//
//   GET    /playbooks               -> listPlaybooks (the MERGED shelf: verified + own)
//   GET    /playbooks/:playbookId   -> findPlaybookById (full body)
//   GET    /documents               -> listInstructionDocuments (the user's own books)
//   POST   /documents               -> createInstructionDocument
//   PATCH  /documents/:documentId   -> updateInstructionDocument (OWN docs only)
//   DELETE /documents/:documentId   -> deleteInstructionDocument (OWN docs only)
//
// Notebooks are BOOKS — on-demand reference material Claude opens when a task
// calls for it. VERIFIED books ship from the repo directory and are immutable
// EVERYWHERE: they have no DB rows, so PATCH/DELETE on a verified id falls
// through the ops' row lookup and 404s by construction. Users CRUD only their
// OWN books — the ownership gate lives in the core ops, not here.
//
// Locked Hono protocol: describeRoute -> validator -> `...userScoped` ->
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).
//
// MCP exposure: NONE. Claude reads the notebook through the `vynel-notebook`
// McpFeatureDescriptor (`@vynel/instructions`), never through HTTP tools —
// and it never writes (settled fork #1: "claude can make mistakes").

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  listPlaybooks,
  findPlaybookById,
  listInstructionDocuments,
  createInstructionDocument,
  updateInstructionDocument,
  deleteInstructionDocument,
} from '@vynel/instructions'
import { NotFoundError } from '@vynel/errors'
import { serializeNotebookDocument } from './serializers.js'
import {
  PlaybookShelfQuerySchema,
  PlaybookParamSchema,
  NotebookDocumentParamSchema,
  CreateNotebookDocumentBodySchema,
  UpdateNotebookDocumentBodySchema,
  PlaybookSchema,
  ListPlaybooksResponseSchema,
  NotebookDocumentSchema,
  ListNotebookDocumentsResponseSchema,
} from './schemas.js'

export const notebookApp = factory
  .createApp()
  // ──────────────────────────────────────────────────────────────────
  // GET /playbooks — the merged shelf (verified first, then own books)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/playbooks',
    describeRoute({
      tags: ['notebook'],
      summary: 'List the playbook shelf — verified books plus the user\'s own.',
      'x-sdk-name': 'notebook.listPlaybooks',
      responses: {
        200: {
          description:
            '{ playbooks: PlaybookListing[] } — verified books lead; a verified id wins a collision.',
          content: { 'application/json': { schema: resolver(ListPlaybooksResponseSchema) } },
        },
      },
    }),
    validator('query', PlaybookShelfQuerySchema),
    ...userScoped,
    (c) => {
      const { workspaceId } = c.req.valid('query')
      const playbooks = listPlaybooks(c.var.db, {
        userId: c.var.user.id,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      })
      return c.json({ playbooks })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /playbooks/:playbookId — one book, full body (verified or own)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/playbooks/:playbookId',
    describeRoute({
      tags: ['notebook'],
      summary: 'Read one playbook (verified or the user\'s own) with its full body.',
      'x-sdk-name': 'notebook.getPlaybook',
      responses: {
        200: {
          description: 'Playbook (listing fields + body).',
          content: { 'application/json': { schema: resolver(PlaybookSchema) } },
        },
        404: { description: 'No such playbook on this shelf.' },
      },
    }),
    validator('param', PlaybookParamSchema),
    validator('query', PlaybookShelfQuerySchema),
    ...userScoped,
    (c) => {
      const { playbookId } = c.req.valid('param')
      const { workspaceId } = c.req.valid('query')
      const playbook = findPlaybookById(
        c.var.db,
        {
          userId: c.var.user.id,
          ...(workspaceId !== undefined ? { workspaceId } : {}),
        },
        playbookId,
      )
      if (playbook === null) throw new NotFoundError('playbook', playbookId)
      return c.json(playbook)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // GET /documents — the user's own books (management list: every scope,
  // disabled included — unlike the shelf, which is Claude's enabled view)
  // ──────────────────────────────────────────────────────────────────
  .get(
    '/documents',
    describeRoute({
      tags: ['notebook'],
      summary: "List every notebook document the user owns (both scopes, disabled included).",
      'x-sdk-name': 'notebook.listDocuments',
      responses: {
        200: {
          description: '{ documents: NotebookDocument[] }.',
          content: { 'application/json': { schema: resolver(ListNotebookDocumentsResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const documents = listInstructionDocuments(c.var.db, { userId: c.var.user.id })
      return c.json({ documents: documents.map(serializeNotebookDocument) })
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // POST /documents — write a book (global, or into one owned workspace)
  // ──────────────────────────────────────────────────────────────────
  .post(
    '/documents',
    describeRoute({
      tags: ['notebook'],
      summary: 'Create a notebook document (a user-authored book).',
      'x-sdk-name': 'notebook.createDocument',
      responses: {
        201: {
          description: 'NotebookDocument created.',
          content: { 'application/json': { schema: resolver(NotebookDocumentSchema) } },
        },
        400: { description: 'Validation error (scope/workspaceId pairing, title, or body).' },
        404: { description: 'Workspace not found (or not owned by this user).' },
      },
    }),
    validator('json', CreateNotebookDocumentBodySchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const document = createInstructionDocument(c.var.db, {
        userId: c.var.user.id,
        scope: body.scope,
        title: body.title,
        body: body.body,
        ...(body.workspaceId !== undefined ? { workspaceId: body.workspaceId } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      })
      return c.json(serializeNotebookDocument(document), 201)
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // PATCH /documents/:documentId — edit an OWN book (title/body/enabled).
  // A verified id has no row → 404 by construction (immutable everywhere).
  // ──────────────────────────────────────────────────────────────────
  .patch(
    '/documents/:documentId',
    describeRoute({
      tags: ['notebook'],
      summary: 'Update a notebook document the user owns (title, body, enabled).',
      'x-sdk-name': 'notebook.updateDocument',
      responses: {
        200: {
          description: 'NotebookDocument updated.',
          content: { 'application/json': { schema: resolver(NotebookDocumentSchema) } },
        },
        400: { description: 'Validation error (empty patch, title, or body).' },
        404: { description: 'No such document owned by this user (verified books included).' },
      },
    }),
    validator('param', NotebookDocumentParamSchema),
    validator('json', UpdateNotebookDocumentBodySchema),
    ...userScoped,
    (c) => {
      const { documentId } = c.req.valid('param')
      const body = c.req.valid('json')
      const updated = updateInstructionDocument(
        c.var.db,
        { documentId, userId: c.var.user.id },
        {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
      )
      return c.json(serializeNotebookDocument(updated))
    },
  )
  // ──────────────────────────────────────────────────────────────────
  // DELETE /documents/:documentId — remove an OWN book (hard delete)
  // ──────────────────────────────────────────────────────────────────
  .delete(
    '/documents/:documentId',
    describeRoute({
      tags: ['notebook'],
      summary: 'Delete a notebook document the user owns.',
      'x-sdk-name': 'notebook.deleteDocument',
      responses: {
        204: { description: 'Deleted (no body).' },
        404: { description: 'No such document owned by this user (verified books included).' },
      },
    }),
    validator('param', NotebookDocumentParamSchema),
    ...userScoped,
    (c) => {
      const { documentId } = c.req.valid('param')
      deleteInstructionDocument(c.var.db, { documentId, userId: c.var.user.id })
      return c.body(null, 204)
    },
  )
