// The per-kind install manifest an `mcp` catalog item carries in its
// (hub-opaque) `manifestJson` — parsed DESKTOP-side at browse/install time.
// An mcp item holds no artifact: the manifest IS the install (config-is-truth,
// Chad 2026-08-02) — installing writes one entry into the scope's Claude MCP
// config (`~/.claude.json` mcpServers / workspace `.mcp.json`), which native
// Claude tooling reads directly.
//
// The parsed shape deliberately matches the skills catalog's
// `SkillRequiredMcpServer` field-for-field, so the skills leaf's single
// MCP-config writer (coding.md §1.2 — the only writer of these files)
// accepts it without a mapping layer. Discriminated on `transport` like the
// contract type: stdio = command/args/env, remote (http/sse) = url + headers.
//
// Published manifests are immutable hub rows, so the parser stays tolerant
// of the PRE-discrimination shape: an old remote manifest carried the URL in
// `commandOrUrl` — it is lifted into `url` here rather than dropping the row
// off the shelf.

import { z } from 'zod'

/** Unique key within the config's `mcpServers` map — the install anchor. */
const ServerNameSchema = z.string().min(1).max(120)

const McpItemStdioManifestSchema = z.object({
  serverName: ServerNameSchema,
  transport: z.literal('stdio'),
  /** The executable command. */
  commandOrUrl: z.string().min(1).max(500),
  args: z.array(z.string().max(500)).max(32).default([]),
  /** Env vars passed to the MCP server process. */
  environment: z.record(z.string(), z.string()).default({}),
})

const remoteManifestShape = {
  serverName: ServerNameSchema,
  /** The remote endpoint URL. */
  url: z.string().min(1).max(500),
  /** Static auth headers — secret values; never logged or listed. */
  headers: z.record(z.string(), z.string()).default({}),
}

export const McpItemManifestSchema = z.preprocess(
  liftLegacyRemoteUrl,
  z.union([
    McpItemStdioManifestSchema,
    z.object({ transport: z.literal('http'), ...remoteManifestShape }),
    z.object({ transport: z.literal('sse'), ...remoteManifestShape }),
  ]),
)

export type McpItemManifest = z.infer<typeof McpItemManifestSchema>

// Old remote manifests (pre 2026-08-02) had no `url` field — the URL rode in
// `commandOrUrl`. Lift it so those published rows keep installing correctly.
function liftLegacyRemoteUrl(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if (
    (record.transport === 'http' || record.transport === 'sse') &&
    record.url === undefined &&
    typeof record.commandOrUrl === 'string'
  ) {
    return { ...record, url: record.commandOrUrl }
  }
  return value
}

/** Lenient parse for catalog rows: browse must never throw on one bad row —
 * an unparsable mcp manifest just keeps the row off the shelf entirely
 * (no dead Get buttons). */
export function parseMcpItemManifest(manifestJson: string | null): McpItemManifest | null {
  if (manifestJson === null) return null
  try {
    const result = McpItemManifestSchema.safeParse(JSON.parse(manifestJson))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
