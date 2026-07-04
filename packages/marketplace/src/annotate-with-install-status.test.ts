// TDD-first tests for the pure annotation helper. Per blueprint
// §13.1 + coding.md §8.1. Pure function — no DB, no fixtures from
// `withTestDatabase`. Installed skills are passed as the local
// `InstalledSkillView` (the 5 fields the helper reads) — the leaf
// never imports the skills row type.

import { describe, it, expect } from 'vitest'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledSkillView } from './marketplace-types.js'

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: 'email-drafter',
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

describe('annotateWithInstallStatus', () => {
  it('returns not-installed when no matches', () => {
    const item = makeItem()
    const [annotated] = annotateWithInstallStatus({
      catalogItems: [item],
      installedSkills: [],
    })
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('returns installed with scope=user when only user-scope match exists', () => {
    const item = makeItem()
    const install = makeInstall({ id: 'u1', scope: 'user', workspaceId: null })
    const [annotated] = annotateWithInstallStatus({
      catalogItems: [item],
      installedSkills: [install],
    })
    expect(annotated?.installStatus).toEqual({
      kind: 'installed',
      scope: 'user',
      installedSkillId: 'u1',
      versionInstalled: '1.0.0',
    })
  })

  it('returns installed with scope=workspace when only workspace-scope match exists', () => {
    const item = makeItem()
    const install = makeInstall({ id: 'w1', scope: 'workspace', workspaceId: 'ws1' })
    const [annotated] = annotateWithInstallStatus({
      catalogItems: [item],
      installedSkills: [install],
    })
    expect(annotated?.installStatus).toEqual({
      kind: 'installed',
      scope: 'workspace',
      installedSkillId: 'w1',
      versionInstalled: '1.0.0',
    })
  })

  it('prefers workspace-scope match over user-scope when both exist (D12)', () => {
    const item = makeItem()
    const userInstall = makeInstall({ id: 'u1', scope: 'user', workspaceId: null })
    const wsInstall = makeInstall({ id: 'w1', scope: 'workspace', workspaceId: 'ws1' })
    const [annotated] = annotateWithInstallStatus({
      catalogItems: [item],
      installedSkills: [userInstall, wsInstall],
    })
    expect(annotated?.installStatus).toMatchObject({
      kind: 'installed',
      scope: 'workspace',
      installedSkillId: 'w1',
    })
  })

  it('does not match installs for a different skillId', () => {
    const item = makeItem()
    const other = makeInstall({
      id: 'o1',
      skillId: 'other-skill',
      scope: 'user',
      workspaceId: null,
    })
    const [annotated] = annotateWithInstallStatus({
      catalogItems: [item],
      installedSkills: [other],
    })
    expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
  })

  it('handles multiple catalog items independently', () => {
    const items = [makeItem({ itemId: 'a', skillId: 'a' }), makeItem({ itemId: 'b', skillId: 'b' })]
    const installs = [makeInstall({ skillId: 'b', id: 'b1' })]
    const annotated = annotateWithInstallStatus({ catalogItems: items, installedSkills: installs })
    expect(annotated[0]?.installStatus.kind).toBe('not-installed')
    expect(annotated[1]?.installStatus).toMatchObject({
      kind: 'installed',
      installedSkillId: 'b1',
    })
  })

  it('returns an empty list when catalog is empty', () => {
    const annotated = annotateWithInstallStatus({
      catalogItems: [],
      installedSkills: [makeInstall()],
    })
    expect(annotated).toEqual([])
  })
})
