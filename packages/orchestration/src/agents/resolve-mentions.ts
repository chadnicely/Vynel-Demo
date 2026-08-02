// Composer-token resolution (chat-mentions) — maps the tokens
// `parseComposerTokens` found in a user turn onto REAL rows: `@` mentions onto
// agents (workspace scope preferred, then user scope) or workspace personas
// (manager names), `#` refs onto workspaces. The grammar lives in ONE home
// (`@vynel/contracts/chat/composer-tokens`); this is the lookup half the
// server-side turn paths call — the client's picker payload is never trusted.
//
// Collision rule (settled): a token is tried as an AGENT SLUG first, then as a
// persona. Slugs are kebab-lowercase and personas Capitalized, so real overlap
// requires a user-renamed lowercase manager — the deterministic order still
// picks the agent. A token matching neither is just text (silently dropped —
// the standing mention posture). Ambiguity (two workspaces sharing a manager
// name / a case-insensitive name match) resolves to the MOST RECENTLY ACCESSED
// workspace — the repo's list order, stable and explainable.
//
// Reaches `agents` through its core op and workspaces through the KERNEL
// repository (workspaces is a tenancy hub — its reads live in `@vynel/db`, so
// no sibling-leaf import is needed).

import type { Database } from '@vynel/db'
import { listAgentsForWorkspace } from '@vynel/agents'
import { listWorkspacesForUser, type Workspace } from '@vynel/db/repositories/workspaces'
import { parseComposerTokens } from '@vynel/contracts/chat/composer-tokens'
import { resolveManagerName } from '@vynel/contracts/workspaces/manager-name'
import type { AgentMention } from '../orchestration-types.js'

export type ResolveMentionsInput = {
  text: string
  userId: string
  /** The originating chat's workspace scope — null for the global root. */
  workspaceId: string | null
}

/** A resolved `@Persona` mention — the workspace whose manager was named. */
export type PersonaMention = {
  managerName: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
}

/** A resolved `#workspace` ref — a workspace the user wants studied this turn. */
export type WorkspaceRefMatch = {
  workspaceId: string
  workspaceName: string
  workspacePath: string
  managerName: string
}

export type ResolvedComposerMentions = {
  agents: AgentMention[]
  personas: PersonaMention[]
  workspaceRefs: WorkspaceRefMatch[]
}

const EMPTY_RESOLUTION: ResolvedComposerMentions = {
  agents: [],
  personas: [],
  workspaceRefs: [],
}

/**
 * Resolve one turn's composer tokens against real data. Each resolved entry
 * appears ONCE (first-seen order) even when the text repeats the token; every
 * unresolvable token is dropped. Works for the global root (`workspaceId`
 * null: user-scope agents, all the user's workspaces) and for workspace chats
 * (that workspace's agents ∪ user scope).
 */
export async function resolveMentions(
  db: Database,
  input: ResolveMentionsInput,
): Promise<ResolvedComposerMentions> {
  const tokens = parseComposerTokens(input.text)
  if (tokens.mentions.length === 0 && tokens.workspaceRefs.length === 0) {
    return EMPTY_RESOLUTION
  }

  // Workspaces load once, shared by persona + ref resolution; most recently
  // accessed first (the ambiguity rule above).
  const workspaces: Workspace[] = listWorkspacesForUser(db, input.userId)

  const agents: AgentMention[] = []
  const personas: PersonaMention[] = []
  if (tokens.mentions.length > 0) {
    const available = await listAgentsForWorkspace(db, {
      userId: input.userId,
      workspaceId: input.workspaceId,
    })
    const agentBySlug = new Map(available.map((agent) => [agent.slug, agent]))

    const seenNames = new Set<string>()
    const seenAgentIds = new Set<string>()
    const seenPersonaWorkspaceIds = new Set<string>()
    for (const mention of tokens.mentions) {
      if (seenNames.has(mention.name)) continue
      seenNames.add(mention.name)

      const agent = agentBySlug.get(mention.name)
      if (agent !== undefined) {
        if (!seenAgentIds.has(agent.id)) {
          seenAgentIds.add(agent.id)
          agents.push({ slug: agent.slug, agentId: agent.id, name: agent.name })
        }
        continue
      }

      // Persona: exact (case-sensitive) match on the RESOLVED manager name —
      // renamed or derived-default alike.
      const workspace = workspaces.find(
        (candidate) => resolveManagerName(candidate) === mention.name,
      )
      if (workspace !== undefined && !seenPersonaWorkspaceIds.has(workspace.id)) {
        seenPersonaWorkspaceIds.add(workspace.id)
        personas.push({
          managerName: mention.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          workspacePath: workspace.path,
        })
      }
    }
  }

  const workspaceRefs: WorkspaceRefMatch[] = []
  if (tokens.workspaceRefs.length > 0) {
    const seenRefNames = new Set<string>()
    const seenRefWorkspaceIds = new Set<string>()
    for (const ref of tokens.workspaceRefs) {
      const nameKey = ref.name.toLowerCase()
      if (seenRefNames.has(nameKey)) continue
      seenRefNames.add(nameKey)

      // Case-insensitive exact name match — workspace names are user-typed
      // labels, and #vynel should find "Vynel".
      const workspace = workspaces.find(
        (candidate) => candidate.name.toLowerCase() === nameKey,
      )
      if (workspace !== undefined && !seenRefWorkspaceIds.has(workspace.id)) {
        seenRefWorkspaceIds.add(workspace.id)
        workspaceRefs.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          workspacePath: workspace.path,
          managerName: resolveManagerName(workspace),
        })
      }
    }
  }

  return { agents, personas, workspaceRefs }
}
