// The merged playbook shelf both notebook tools read: the VERIFIED books
// (repo-shipped, immutable) plus the caller's own enabled notebook-mode
// documents for the turn's scope. ONE home for the merge + the collision
// rule (verified wins an id collision — the team's book can't be shadowed by
// a user doc), so `list_playbooks` and `read_playbook` can never disagree.

import type { Database } from '@vynel/db'
import { listInstructionDocuments } from '../queries/list-instruction-documents.js'
import type { InstructionDocument } from '../repositories/index.js'
import {
  listVerifiedNotebooks,
  findVerifiedNotebookById,
} from '../notebooks/verified-notebooks.js'

export type PlaybookListing = {
  id: string
  title: string
  oneLiner: string
  verified: boolean
}

export type Playbook = PlaybookListing & { body: string }

export type PlaybookShelfScope = {
  userId: string
  /** Absent on a global-root turn (global docs only); present on a workspace
   *  turn (global + that workspace's docs). */
  workspaceId?: string
}

const ONE_LINER_MAX_LENGTH = 140

// User documents carry no oneLiner column — derive the shelf line from the
// body's first non-empty line so the model can judge relevance without a read.
export function deriveOneLiner(body: string): string {
  const firstLine =
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/^[#>\-*\s]+/, '').trim())
      .find((line) => line.length > 0) ?? ''
  return firstLine.length > ONE_LINER_MAX_LENGTH
    ? `${firstLine.slice(0, ONE_LINER_MAX_LENGTH - 1)}…`
    : firstLine
}

function listUserNotebookDocuments(db: Database, scope: PlaybookShelfScope): InstructionDocument[] {
  return listInstructionDocuments(db, {
    userId: scope.userId,
    visibleFrom: scope.workspaceId !== undefined ? { workspaceId: scope.workspaceId } : 'global',
    enabledOnly: true,
  })
}

export function listPlaybooks(db: Database, scope: PlaybookShelfScope): PlaybookListing[] {
  const verified = listVerifiedNotebooks()
  const verifiedIds = new Set(verified.map((notebook) => notebook.id))
  const userListings = listUserNotebookDocuments(db, scope)
    // Verified wins an id collision — drop the shadowed user doc so the list
    // and `read_playbook` tell the same story. (User ids are UUIDs, so this
    // only guards a deliberately crafted collision.)
    .filter((document) => !verifiedIds.has(document.id))
    .map((document) => ({
      id: document.id,
      title: document.title,
      oneLiner: deriveOneLiner(document.body),
      verified: false,
    }))
  return [
    ...verified.map(({ id, title, oneLiner }) => ({ id, title, oneLiner, verified: true })),
    ...userListings,
  ]
}

export function findPlaybookById(
  db: Database,
  scope: PlaybookShelfScope,
  playbookId: string,
): Playbook | null {
  const verified = findVerifiedNotebookById(playbookId)
  if (verified !== null) {
    return {
      id: verified.id,
      title: verified.title,
      oneLiner: verified.oneLiner,
      body: verified.body,
      verified: true,
    }
  }
  const document = listUserNotebookDocuments(db, scope).find((row) => row.id === playbookId)
  if (document === undefined) return null
  return {
    id: document.id,
    title: document.title,
    oneLiner: deriveOneLiner(document.body),
    body: document.body,
    verified: false,
  }
}
