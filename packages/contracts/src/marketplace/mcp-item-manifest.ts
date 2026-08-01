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
// accepts it without a mapping layer.

import { z } from 'zod'

export const McpItemManifestSchema = z.object({
  /** Unique key within the config's `mcpServers` map — the install anchor. */
  serverName: z.string().min(1).max(120),
  transport: z.enum(['stdio', 'http', 'sse']),
  /** For stdio: the executable command. For http/sse: the URL. */
  commandOrUrl: z.string().min(1).max(500),
  /** For stdio: command args. For http/sse: empty. */
  args: z.array(z.string().max(500)).max(32).default([]),
  /** Env vars passed to the MCP server process. */
  environment: z.record(z.string(), z.string()).default({}),
})

export type McpItemManifest = z.infer<typeof McpItemManifestSchema>

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
