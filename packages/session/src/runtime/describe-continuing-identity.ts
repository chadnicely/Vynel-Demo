// `describeContinuingIdentity` — the ONE home for "who is this conversation":
// the primary's scope + its own name, read from its own rows. Both places
// that tell a session who it is read from here — the swap carry's IDENTITY
// line (`buildContinuityContext`) and the `whoami` tool — so they can never
// disagree.
//
// A spawned session's or colleague's name lives on its LISTED identity row (the
// chain's origin segment); a swap never moves it, and a mid-chain "Continued
// conversation" is not a name. A workspace is named from its own row.

import type { Database } from '@vynel/db'
import { findWorkspaceById } from '@vynel/workspaces'
import type { PrimarySessionRow, PrimarySessionScope } from '../repositories/index.js'
import { resolveListedOriginTitle } from './resolve-primary-transcript.js'

export type ContinuingIdentityDescription = {
  kind: PrimarySessionScope
  /** Prose completing "You are …" — e.g. `the spawned session “Mailing feature”, grounded in workspace “Acme”`. */
  line: string
  /** The identity row's title (spawned / colleague); null for the manager scopes. */
  name: string | null
  workspaceName: string | null
}

export function describeContinuingIdentity(
  db: Database,
  primary: PrimarySessionRow,
  /** The chain head to name the identity from — the current or just-superseded segment. */
  headSessionId: string | null,
): ContinuingIdentityDescription {
  const workspaceName =
    primary.workspaceId !== null ? (findWorkspaceById(db, primary.workspaceId)?.name ?? null) : null
  const ground = workspaceName !== null ? `workspace “${workspaceName}”` : 'the global scope'
  const namedFromChain = (): string | null =>
    headSessionId !== null
      ? resolveListedOriginTitle(db, { userId: primary.userId, headSessionId })
      : null

  switch (primary.scope) {
    case 'global':
      return {
        kind: 'global',
        line: "the global assistant — the continuing conversation above all of the user's workspaces",
        name: null,
        workspaceName,
      }
    case 'voice':
      return {
        kind: 'voice',
        line: "the user's voice conversation — the continuing spoken thread above all workspaces",
        name: null,
        workspaceName,
      }
    case 'workspace':
      return {
        kind: 'workspace',
        line: `the continuing main conversation of ${workspaceName !== null ? `workspace “${workspaceName}”` : 'this workspace'}`,
        name: null,
        workspaceName,
      }
    case 'spawned': {
      const name = namedFromChain()
      return {
        kind: 'spawned',
        line: `the spawned session${name !== null ? ` “${name}”` : ''}, grounded in ${ground}`,
        name,
        workspaceName,
      }
    }
    case 'agent': {
      const name = namedFromChain()
      const slug = primary.scopeRef !== null ? ` (agent “${primary.scopeRef}”)` : ''
      return {
        kind: 'agent',
        line: `the agent colleague${name !== null ? ` “${name}”` : ''}${slug}, grounded in ${ground}`,
        name,
        workspaceName,
      }
    }
  }
}
