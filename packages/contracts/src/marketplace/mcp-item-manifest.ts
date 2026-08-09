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
// Per-user auth (2026-08-09) is DECLARED, never published: a manifest says
// what the install needs (`requiredEnvironment` for stdio keys,
// `auth: headers` for per-user tokens, `auth: oauth` for the native
// `claude mcp login` flow) and the user supplies values at install time —
// a shared secret in a public catalog row was never an honest option.
// `resolveMcpInstallConfiguration` is the one home turning manifest +
// user-supplied values into the entry the config writer accepts.
//
// Published manifests are immutable hub rows, so the parser stays tolerant
// of the PRE-discrimination shape: an old remote manifest carried the URL in
// `commandOrUrl` — it is lifted into `url` here rather than dropping the row
// off the shelf.

import { z } from 'zod'
import type { SkillRequiredMcpServer } from '../skills/verified-skills/verified-skill-definition.js'

/** Unique key within the config's `mcpServers` map — the install anchor. */
const ServerNameSchema = z.string().min(1).max(120)

/** One value the user must supply at install time (an env var or header).
 * `secret` defaults true — masked input, never logged, never echoed. */
const McpConfigFieldSchema = z.object({
  name: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  secret: z.boolean().default(true),
})

export type McpConfigField = z.infer<typeof McpConfigFieldSchema>

const McpItemStdioManifestSchema = z.object({
  serverName: ServerNameSchema,
  transport: z.literal('stdio'),
  /** The executable command. */
  commandOrUrl: z.string().min(1).max(500),
  args: z.array(z.string().max(500)).max(32).default([]),
  /** Publisher-set env defaults (non-secret — the row is public). */
  environment: z.record(z.string(), z.string()).default({}),
  /** Env vars the USER supplies at install (API keys etc.). */
  requiredEnvironment: z.array(McpConfigFieldSchema).max(16).default([]),
})

const remoteManifestShape = {
  serverName: ServerNameSchema,
  /** The remote endpoint URL. */
  url: z.string().min(1).max(500),
  /** Publisher-set static headers (non-secret — the row is public). */
  headers: z.record(z.string(), z.string()).default({}),
  /** How the user authenticates: 'oauth' = the native `claude mcp login`
   * browser flow after install; 'headers' = user-supplied header values at
   * install. Absent = the server needs no per-user auth. */
  auth: z
    .union([
      z.object({ type: z.literal('oauth') }),
      z.object({
        type: z.literal('headers'),
        requiredHeaders: z.array(McpConfigFieldSchema).min(1).max(8),
      }),
    ])
    .optional(),
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

/** What the card must know BEFORE install: a configure step (user-supplied
 * values), an OAuth connect step after install, or nothing (null). */
export type McpItemAuthView =
  | { kind: 'oauth' }
  | { kind: 'fields'; fields: McpConfigField[] }

export function toMcpItemAuthView(manifest: McpItemManifest): McpItemAuthView | null {
  if (manifest.transport === 'stdio') {
    return manifest.requiredEnvironment.length > 0
      ? { kind: 'fields', fields: manifest.requiredEnvironment }
      : null
  }
  if (manifest.auth === undefined) return null
  return manifest.auth.type === 'oauth'
    ? { kind: 'oauth' }
    : { kind: 'fields', fields: manifest.auth.requiredHeaders }
}

export type ResolveMcpInstallConfigurationResult =
  | {
      ok: true
      /** The entry shape the skills leaf's config writer accepts — declared
       * auth stripped, user-supplied values merged over publisher defaults. */
      server: SkillRequiredMcpServer
      /** True for oauth manifests — the entry is written without credentials
       * and the user connects via the native login flow afterwards. */
      authRequired: boolean
    }
  | {
      ok: false
      /** Labels of declared required fields that are absent or blank. */
      missingFieldLabels: string[]
      /** Supplied names no declared field matches — refused, so install
       * values can never inject arbitrary env vars or headers. */
      unknownFieldNames: string[]
    }

/** Pure resolution of manifest + user-supplied configuration values into the
 * installable server entry. Values are keyed by the declared field `name`;
 * every declared field is required, undeclared names are refused. Contracts
 * stays dependency-free: the caller maps the failure to its typed error. */
export function resolveMcpInstallConfiguration(
  manifest: McpItemManifest,
  suppliedValues: Record<string, string>,
): ResolveMcpInstallConfigurationResult {
  const declaredFields =
    manifest.transport === 'stdio'
      ? manifest.requiredEnvironment
      : manifest.auth?.type === 'headers'
        ? manifest.auth.requiredHeaders
        : []

  const declaredNames = new Set(declaredFields.map((field) => field.name))
  const missingFieldLabels = declaredFields
    .filter((field) => {
      const value = suppliedValues[field.name]
      return value === undefined || value.trim().length === 0
    })
    .map((field) => field.label)
  const unknownFieldNames = Object.keys(suppliedValues).filter(
    (name) => !declaredNames.has(name),
  )
  if (missingFieldLabels.length > 0 || unknownFieldNames.length > 0) {
    return { ok: false, missingFieldLabels, unknownFieldNames }
  }

  const suppliedByDeclaredName: Record<string, string> = {}
  for (const field of declaredFields) {
    suppliedByDeclaredName[field.name] = suppliedValues[field.name]!
  }

  if (manifest.transport === 'stdio') {
    return {
      ok: true,
      server: {
        serverName: manifest.serverName,
        transport: 'stdio',
        commandOrUrl: manifest.commandOrUrl,
        args: manifest.args,
        environment: { ...manifest.environment, ...suppliedByDeclaredName },
      },
      authRequired: false,
    }
  }
  return {
    ok: true,
    server: {
      serverName: manifest.serverName,
      transport: manifest.transport,
      url: manifest.url,
      headers: { ...manifest.headers, ...suppliedByDeclaredName },
    },
    authRequired: manifest.auth?.type === 'oauth',
  }
}
