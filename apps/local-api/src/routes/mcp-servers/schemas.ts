// Zod request/response schemas for the `mcp-servers` routes. Per
// `coding-standard.md` "Zod schemas" — API-internal (single consumer =
// apps/local-web) lives under the route folder.
//
// SECURITY SHAPE: the list/add responses are MASKED — header VALUES and env
// VALUES never ride the wire out of the backend (names + presence only).
// Only the ADD request carries them in (once, over localhost, into the
// config file — the accepted design).

import { z } from 'zod'

const ServerNameSchema = z.string().trim().min(1).max(120)
// Secret-bearing maps: bounded key/value sizes; keys must be non-blank.
const SecretRecordSchema = z.record(z.string().trim().min(1).max(200), z.string().max(4000))

export const AddMcpServerRequestSchema = z.discriminatedUnion('transport', [
  z.object({
    serverName: ServerNameSchema,
    transport: z.literal('stdio'),
    command: z.string().trim().min(1).max(500),
    args: z.array(z.string().max(500)).max(32).default([]),
    environment: SecretRecordSchema.default({}),
  }),
  z.object({
    serverName: ServerNameSchema,
    transport: z.literal('http'),
    url: z.string().trim().min(1).max(500),
    headers: SecretRecordSchema.default({}),
  }),
  z.object({
    serverName: ServerNameSchema,
    transport: z.literal('sse'),
    url: z.string().trim().min(1).max(500),
    headers: SecretRecordSchema.default({}),
  }),
])

export const ServerNameParamSchema = z.object({
  serverName: z.string().min(1).max(120),
})

// ── Response schemas ────────────────────────────────────────────────

const MaskedHeaderSchema = z.object({
  name: z.string(),
  hasValue: z.boolean(),
})

export const McpServerRowSchema = z.object({
  serverName: z.string(),
  scope: z.enum(['user', 'workspace']),
  transport: z.enum(['stdio', 'http', 'sse']),
  /** stdio: the command. http/sse: the URL. */
  commandOrUrl: z.string(),
  /** stdio only; [] for remote. */
  args: z.array(z.string()),
  /** Env var NAMES only — values are secrets and never leave the backend. */
  environmentKeys: z.array(z.string()),
  /** Header names + presence only — values are secrets. */
  headers: z.array(MaskedHeaderSchema),
})

export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerRowSchema),
})

// The login route resolves only when the native CLI recorded the
// credential — a boolean literal keeps the response honest (failure is a
// typed error, never `connected: false`).
export const LoginMcpServerResponseSchema = z.object({
  connected: z.literal(true),
})
