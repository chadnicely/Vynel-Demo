// TDD-first tests for the pure annotation helper. Per blueprint
// §13.1 + coding.md §8.1. Pure function — no DB, no fixtures from
// `withTestDatabase`. Installed skills/agents are passed as the local
// structural views (the fields the helper reads) — the leaf never
// imports a sibling leaf's row type.

import { describe, it, expect } from 'vitest'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledAgentView, InstalledSkillView } from './marketplace-types.js'

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: 'email-drafter',
    kind: 'skill',
    skillId: 'email-drafter',
    publisherTier: 'verified',
    publisherName: 'Vynel Team',
    publisherUrl: null,
    displayName: 'Email Drafter',
    oneLineDescription: 'Draft contextual email replies.',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    releasedAt: '2026-01-01T00:00:00Z',
    recommendedScope: 'user',
    isOfficial: true,
    installStatus: { kind: 'not-installed' },
    ...overrides,
  }
}

function makeInstall(overrides: Partial<InstalledSkillView> = {}): InstalledSkillView {
  return {
    id: 'install-1',
    workspaceId: null,
    skillId: 'email-drafter',
    scope: 'user',
    versionInstalled: '1.0.0',
    ...overrides,
  }
}

function annotate(
  catalogItems: MarketplaceItem[],
  installedSkills: InstalledSkillView[] = [],
  installedAgents: InstalledAgentView[] = [],
): MarketplaceItem[] {
  return annotateWithInstallStatus({ catalogItems, installedSkills, installedAgents })
}

describe('annotateWithInstallStatus', () => {
  it('returns not-installed when no matches', () => {
    const [annotated] = annotate([makeItem()])
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('returns installed with scope=user when only user-scope match exists', () => {
    const install = makeInstall({ id: 'u1', scope: 'user', workspaceId: null })
    const [annotated] = annotate([makeItem()], [install])
    expect(annotated?.installStatus).toEqual({
      kind: 'installed',
      scope: 'user',
      installedId: 'u1',
      versionInstalled: '1.0.0',
    })
  })

  it('returns installed with scope=workspace when only workspace-scope match exists', () => {
    const install = makeInstall({ id: 'w1', scope: 'workspace', workspaceId: 'ws1' })
    const [annotated] = annotate([makeItem()], [install])
    expect(annotated?.installStatus).toEqual({
      kind: 'installed',
      scope: 'workspace',
      installedId: 'w1',
      versionInstalled: '1.0.0',
    })
  })

  it('prefers workspace-scope match over user-scope when both exist (D12)', () => {
    const userInstall = makeInstall({ id: 'u1', scope: 'user', workspaceId: null })
    const wsInstall = makeInstall({ id: 'w1', scope: 'workspace', workspaceId: 'ws1' })
    const [annotated] = annotate([makeItem()], [userInstall, wsInstall])
    expect(annotated?.installStatus).toMatchObject({
      kind: 'installed',
      scope: 'workspace',
      installedId: 'w1',
    })
  })

  it('does not match installs for a different skillId', () => {
    const other = makeInstall({
      id: 'o1',
      skillId: 'other-skill',
      scope: 'user',
      workspaceId: null,
    })
    const [annotated] = annotate([makeItem()], [other])
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('handles multiple catalog items independently', () => {
    const items = [makeItem({ itemId: 'a', skillId: 'a' }), makeItem({ itemId: 'b', skillId: 'b' })]
    const installs = [makeInstall({ skillId: 'b', id: 'b1' })]
    const annotated = annotate(items, installs)
    expect(annotated[0]?.installStatus.kind).toBe('not-installed')
    expect(annotated[1]?.installStatus).toMatchObject({
      kind: 'installed',
      installedId: 'b1',
    })
  })

  it('returns an empty list when catalog is empty', () => {
    const annotated = annotate([], [makeInstall()])
    expect(annotated).toEqual([])
  })
})

describe('annotateWithInstallStatus — agent items (C-agents)', () => {
  const agentItem = makeItem({ itemId: 'focus-writer', kind: 'agent', skillId: 'focus-writer' })

  function makeAgentView(overrides: Partial<InstalledAgentView> = {}): InstalledAgentView {
    return {
      id: 'a1',
      slug: 'focus-writer',
      workspaceId: null,
      source: 'community',
      ...overrides,
    }
  }

  it('marks an agent item installed when a matching slug exists (null version)', () => {
    const [annotated] = annotate([agentItem], [], [makeAgentView()])
    expect(annotated?.installStatus).toEqual({
      kind: 'installed',
      scope: 'user',
      installedId: 'a1',
      versionInstalled: null,
    })
  })

  it('prefers the workspace-scope agent when both scopes exist (D12)', () => {
    const [annotated] = annotate(
      [agentItem],
      [],
      [makeAgentView({ id: 'a1' }), makeAgentView({ id: 'a2', workspaceId: 'ws1' })],
    )
    expect(annotated?.installStatus).toMatchObject({
      kind: 'installed',
      scope: 'workspace',
      installedId: 'a2',
    })
  })

  it('never matches an agent item against installed SKILLS with the same id', () => {
    const [annotated] = annotate([agentItem], [makeInstall({ skillId: 'focus-writer' })], [])
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('never matches a skill item against installed AGENTS with the same id', () => {
    const [annotated] = annotate([makeItem()], [], [makeAgentView({ slug: 'email-drafter' })])
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('never matches a HAND-MADE agent (source=user) whose slug collides with an itemId', () => {
    const [annotated] = annotate([agentItem], [], [makeAgentView({ source: 'user' })])
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('still matches the community-sourced agent when a user-sourced one shares the slug', () => {
    const [annotated] = annotate(
      [agentItem],
      [],
      [
        makeAgentView({ id: 'handmade', source: 'user', workspaceId: 'ws1' }),
        makeAgentView({ id: 'installed', source: 'community' }),
      ],
    )
    expect(annotated?.installStatus).toMatchObject({
      kind: 'installed',
      scope: 'user',
      installedId: 'installed',
    })
  })
})
