// The `mcp` kind's install/uninstall + annotation reader — config-is-truth
// (Chad 2026-08-02): one entry in the scope's Claude MCP config
// (user → `~/.claude.json` mcpServers, workspace → `<workspace>/.mcp.json`)
// IS the installed state; no Vynel DB row. Native Claude tooling reads the
// config directly. Split from `item-lifecycle.ts` when the per-kind
// branches pushed it past the file-size ceiling — the shared surface gate
// and dispatch stay there; this file owns only the mcp bodies.

import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import { ValidationError } from '@vynel/errors'
import { findCachedCloudItem } from '@vynel/marketplace'
import type { InstalledMcpServerView } from '@vynel/marketplace'
import {
  installMcpServerForScope,
  removeMcpServerForScope,
  listMcpServerEntriesForScope,
} from '@vynel/skills'
import {
  parseMcpItemManifest,
  resolveMcpInstallConfiguration,
} from '@vynel/contracts/marketplace/mcp-item-manifest'

// The mcp annotation reader for a surface: the GLOBAL surface reads the
// user config alone; a workspace surface also reads that workspace's
// `.mcp.json`. Binds the skills leaf's sync reader — reads ride its
// host-home seam, so route tests are hermetic without injection.
export function mcpServersReaderFor(
  workspace: { path: string } | null,
): () => InstalledMcpServerView[] {
  return () => [
    ...listMcpServerEntriesForScope('user').map(
      (entry): InstalledMcpServerView => ({
        name: entry.serverName,
        scope: 'user',
        provenanceItemId: entry.provenanceItemId,
      }),
    ),
    ...(workspace !== null
      ? listMcpServerEntriesForScope('workspace', workspace.path).map(
          (entry): InstalledMcpServerView => ({
            name: entry.serverName,
            scope: 'workspace',
            provenanceItemId: entry.provenanceItemId,
          }),
        )
      : []),
  ]
}

export type InstallMcpItemInput = {
  itemId: string
  scope: SkillScope
  workspace: { id: string; path: string } | null
  /** Values for the manifest's declared configuration fields — supplied by
   * the UI's configure dialog. Secrets: never logged. */
  configurationValues: Record<string, string>
}

// The manifest IS the payload — no artifact download, and re-installing
// overwrites the entry (idempotent repair). A manifest declaring required
// configuration installs only with its values supplied (the session tool
// never carries secrets, so its calls land here value-less and get the
// actionable 400 below); an oauth manifest installs credential-less and
// answers authRequired so the connect step follows.
export async function installMcpItem(
  deps: { db: Database; logger: Logger },
  input: InstallMcpItemInput,
) {
  const { itemId, scope, workspace, configurationValues } = input
  const cached = findCachedCloudItem(deps.db, itemId)
  const manifest = parseMcpItemManifest(cached?.latestVersionManifestJson ?? null)
  if (manifest === null) {
    throw new ValidationError('This MCP item carries no server descriptor — re-sync the catalog.')
  }
  if (scope === 'workspace' && workspace === null) {
    throw new ValidationError(
      'A workspace-scope MCP server install needs a workspace — install from that workspace, or pick user scope.',
    )
  }
  const resolved = resolveMcpInstallConfiguration(manifest, configurationValues)
  if (!resolved.ok) {
    // Labels only — never echo supplied values.
    const missing =
      resolved.missingFieldLabels.length > 0
        ? `This server needs configuration before it can work: ${resolved.missingFieldLabels.join(', ')}. ` +
          'Install it from the Marketplace, which asks for these values.'
        : ''
    // Echo at most a handful of names — the message must stay bounded.
    const unknownNames = resolved.unknownFieldNames.slice(0, 8)
    const unknownSuffix = resolved.unknownFieldNames.length > 8 ? ', …' : ''
    const unknown =
      resolved.unknownFieldNames.length > 0
        ? `Unrecognized configuration field(s): ${unknownNames.join(', ')}${unknownSuffix} — only the fields the item declares are accepted.`
        : ''
    throw new ValidationError([missing, unknown].filter(Boolean).join(' '))
  }
  const installInput: Parameters<typeof installMcpServerForScope>[0] = {
    scope,
    server: resolved.server,
    provenance: { itemId, installedAt: new Date().toISOString() },
  }
  if (scope === 'workspace') installInput.workspacePath = workspace!.path
  await installMcpServerForScope(installInput)
  deps.logger.info(
    { itemId, serverName: manifest.serverName, scope, authRequired: resolved.authRequired },
    'marketplace mcp server installed',
  )
  return {
    kind: 'mcp' as const,
    serverName: manifest.serverName,
    itemId,
    scope,
    version: cached?.latestVersion ?? null,
    authRequired: resolved.authRequired,
  }
}

export type UninstallMcpItemInput = {
  itemId: string
  // The annotator's resolution: installedId IS the config's server name,
  // and scope records WHICH config carries it (workspace preferred, D12).
  serverName: string
  serverScope: SkillScope
  workspace: { id: string; path: string } | null
}

export async function uninstallMcpItem(
  deps: { logger: Logger },
  input: UninstallMcpItemInput,
) {
  const { itemId, serverName, serverScope, workspace } = input
  if (serverScope === 'workspace' && workspace === null) {
    // Unreachable by construction (the global surface's reader never
    // reports workspace scope) — guarded so a drift never removes from
    // the wrong config silently.
    throw new ValidationError(
      `MCP server '${serverName}' is workspace-installed — uninstall it from that workspace.`,
    )
  }
  // The annotator only matched a marker-carrying entry, so the marker
  // requirement here is the drift guard: a config edited between annotate
  // and remove surfaces as a ConflictError instead of deleting a stranger.
  const removeInput: Parameters<typeof removeMcpServerForScope>[0] = {
    scope: serverScope,
    serverName,
    onlyIfProvenanceItemId: itemId,
  }
  if (serverScope === 'workspace') removeInput.workspacePath = workspace!.path
  await removeMcpServerForScope(removeInput)
  deps.logger.info({ itemId, serverName, scope: serverScope }, 'marketplace mcp server uninstalled')
  return { kind: 'mcp' as const, serverName, itemId }
}
