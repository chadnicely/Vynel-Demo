// The `rule` kind's install/uninstall + annotation reader — config-is-truth
// (Chad 2026-08-02): a provenance-marked `<itemId>.md` file in the scope's
// `.claude/rules/` folder (user → `~/.claude/rules/`, workspace →
// `<workspace>/.claude/rules/`) IS the installed state; no Vynel DB row.
// Claude Code loads the folder natively. Sibling of `mcp-item-lifecycle.ts`
// (the per-kind split); the skills leaf's marker discipline guarantees the
// user's own hand-written rules never annotate, never get overwritten,
// never get deleted.

import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { ValidationError } from '@vynel/errors'
import { findCachedCloudItem } from '@vynel/marketplace'
import type { InstalledRuleView } from '@vynel/marketplace'
import {
  installRuleFileForScope,
  removeRuleFileForScope,
  listInstalledRulesForScope,
} from '@vynel/skills'
import { parseRuleItemManifest } from '@vynel/contracts/marketplace/rule-item-manifest'

// The rule annotation reader for a surface: the GLOBAL surface reads the
// user folder alone; a workspace surface also reads that workspace's
// `.claude/rules/`. Rides the skills leaf's host-home seam — route tests
// are hermetic without injection.
export function rulesReaderFor(workspace: { path: string } | null): () => InstalledRuleView[] {
  return () => [
    ...listInstalledRulesForScope('user').map(
      (rule): InstalledRuleView => ({ ...rule, scope: 'user' }),
    ),
    ...(workspace !== null
      ? listInstalledRulesForScope('workspace', workspace.path).map(
          (rule): InstalledRuleView => ({ ...rule, scope: 'workspace' }),
        )
      : []),
  ]
}

export type InstallRuleItemInput = {
  itemId: string
  scope: SkillScope
  workspace: { id: string; path: string } | null
}

// The manifest IS the payload; re-installing refreshes a marked file
// (repair / version bump) but an unmarked same-name file — the user's
// own — makes the skills op refuse with a ConflictError.
export async function installRuleItem(
  deps: { db: Database; logger: Logger },
  input: InstallRuleItemInput,
) {
  const { itemId, scope, workspace } = input
  const cached = findCachedCloudItem(deps.db, itemId)
  const manifest = parseRuleItemManifest(cached?.latestVersionManifestJson ?? null)
  if (manifest === null) {
    throw new ValidationError('This rule item carries no rule content — re-sync the catalog.')
  }
  if (scope === 'workspace' && workspace === null) {
    throw new ValidationError(
      'A workspace-scope rule install needs a workspace — install from that workspace, or pick user scope.',
    )
  }
  const version = cached?.latestVersion ?? '0.0.0'
  const installInput: Parameters<typeof installRuleFileForScope>[0] = {
    scope,
    ruleId: itemId,
    version,
    ruleMarkdown: manifest.ruleMarkdown,
  }
  if (scope === 'workspace') installInput.workspacePath = workspace!.path
  await installRuleFileForScope(installInput)
  deps.logger.info({ itemId, scope, version }, 'marketplace rule installed')
  return { kind: 'rule' as const, ruleId: itemId, itemId, scope, version }
}

export type UninstallRuleItemInput = {
  itemId: string
  // The annotator's resolution: installedId IS the rule id, and scope
  // records WHICH folder carries the marked file (workspace preferred, D12).
  ruleId: string
  ruleScope: SkillScope
  workspace: { id: string; path: string } | null
}

export async function uninstallRuleItem(
  deps: { logger: Logger },
  input: UninstallRuleItemInput,
) {
  const { itemId, ruleId, ruleScope, workspace } = input
  if (ruleScope === 'workspace' && workspace === null) {
    // Unreachable by construction (the global surface's reader never
    // reports workspace scope) — guarded so a drift never deletes from
    // the wrong folder silently.
    throw new ValidationError(
      `Rule '${ruleId}' is workspace-installed — uninstall it from that workspace.`,
    )
  }
  const removeInput: Parameters<typeof removeRuleFileForScope>[0] = {
    scope: ruleScope,
    ruleId,
  }
  if (ruleScope === 'workspace') removeInput.workspacePath = workspace!.path
  await removeRuleFileForScope(removeInput)
  deps.logger.info({ itemId, ruleId, scope: ruleScope }, 'marketplace rule uninstalled')
  return { kind: 'rule' as const, ruleId, itemId }
}
