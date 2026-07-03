// `@mention` resolution (backend only — the composer autocomplete UI is a
// later unit). Parses `@slug` tokens from a user turn and maps them to the
// agents available in that (user, workspace) session.
//
// In Mode A the model delegates via the SDK Agent tool and ALL enabled
// agents are made available (`composeSessionAgents`); `resolveMentions` is
// the standalone backend op the future composer + any Mode-B planner build
// on. Reaches `agents` through its CORE op (`listAgentsForWorkspace`),
// never its repository.

import type { Database } from '@vynel/db'
import { listAgentsForWorkspace } from '@vynel/agents'
import type { AgentMention } from '../orchestration-types.js'

// `@` + kebab-case slug (matches the agents-domain slug shape). Global so
// `matchAll` finds every mention in the turn.
const MENTION_PATTERN = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g

/** Pure extractor — the unique `@slug` tokens in a text, in first-seen order. */
export function parseMentionSlugs(text: string): string[] {
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const slug = match[1]
    if (slug !== undefined && !seen.has(slug)) {
      seen.add(slug)
      slugs.push(slug)
    }
  }
  return slugs
}

export type ResolveMentionsInput = {
  text: string
  userId: string
  workspaceId: string
}

/**
 * Resolves the `@mention`s in a turn to the agents available in the session
 * (user-scope ∪ this workspace). Unmatched mentions are dropped (an
 * `@name` that isn't an agent is just text). Returns one entry per matched
 * mention, in first-seen order.
 */
export async function resolveMentions(
  db: Database,
  input: ResolveMentionsInput,
): Promise<AgentMention[]> {
  const slugs = parseMentionSlugs(input.text)
  if (slugs.length === 0) return []

  const available = await listAgentsForWorkspace(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
  const agentBySlug = new Map(available.map((agent) => [agent.slug, agent]))

  const mentions: AgentMention[] = []
  for (const slug of slugs) {
    const agent = agentBySlug.get(slug)
    if (agent !== undefined) {
      mentions.push({ slug: agent.slug, agentId: agent.id, name: agent.name })
    }
  }
  return mentions
}
