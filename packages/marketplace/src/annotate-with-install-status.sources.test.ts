// A skill row that did NOT come from the catalog — discovered on disk
// (`external`) or written in Vynel's editor (`user`) — must never flip a
// Marketplace card to "Installed", even when its frontmatter name equals
// the item's id: the uninstall route resolves through that match and would
// delete the user's own folder (2026-08-26 audit).

import { describe, it, expect } from 'vitest'
import { annotateWithInstallStatus } from './annotate-with-install-status.js'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import type { InstalledSkillView } from './marketplace-types.js'

function makeItem(): MarketplaceItem {
  return {
    itemId: 'email-drafter',
    skillId: 'email-drafter',
    kind: 'skill',
    name: 'Email drafter',
    description: 'Drafts',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    recommendedScope: 'user',
    isOfficial: true,
    hasCloudArtifact: false,
    installStatus: { kind: 'not-installed' },
  } as unknown as MarketplaceItem
}

function makeView(installedFromSource: string): InstalledSkillView {
  return {
    id: 'row',
    skillId: 'email-drafter',
    workspaceId: null,
    scope: 'user',
    versionInstalled: 'unknown',
    installedFromSource,
  }
}

describe('annotateWithInstallStatus — skill sources', () => {
  it('only catalog-sourced rows count as installed', () => {
    for (const source of ['external', 'user']) {
      const [annotated] = annotateWithInstallStatus({
        catalogItems: [makeItem()],
        installedSkills: [makeView(source)],
        installedAgents: [],
        installedPlugins: [],
        installedMcpServers: [],
        installedRules: [],
      })
      expect(annotated?.installStatus).toEqual({ kind: 'not-installed' })
    }
    for (const source of ['verified-catalog', 'marketplace']) {
      const [annotated] = annotateWithInstallStatus({
        catalogItems: [makeItem()],
        installedSkills: [makeView(source)],
        installedAgents: [],
        installedPlugins: [],
        installedMcpServers: [],
        installedRules: [],
      })
      expect(annotated?.installStatus).toMatchObject({ kind: 'installed', installedId: 'row' })
    }
  })
})
