#!/usr/bin/env node
// Executable entry for the external (stdio) MCP server — direction ②. Loads
// env, reads the committed OpenAPI spec, builds a fetch dispatcher targeting
// the api, registers the x-mcp tools, and serves over stdio.
//
// stdio discipline: stdout is the MCP protocol channel — status/errors go to
// stderr only.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import openApiSpec from '@vynel/sdk/openapi.json' with { type: 'json' }
import {
  buildExternalMcpServer,
  type FetchDispatch,
  type OpenApiSpec,
} from './external-mcp-server.js'
import { loadEnv } from './env.js'

// A fetch dispatcher targeting the running api. The tool handlers pass a path
// (+ query); we resolve it against the api's /api gateway mount — at root
// paths the gateway gives /voice/* to the voice-daemon proxy (gateway.ts), so
// root dispatch would break the `speak` tool. Concatenate rather than
// new URL(path, base): an absolute path REPLACES a prefix baked into the
// base. Phase-1 single-user: the api resolves the local user server-side, so
// there's no auth header here.
function createFetchDispatch(apiUrl: string): FetchDispatch {
  const apiMountUrl = apiUrl.replace(/\/+$/, '') + '/api'
  return (url, init) => fetch(new URL(apiMountUrl + url), init)
}

// One startup read of the admin's kill-switches. Best-effort: an unreachable
// api (it may boot after us) means the full registry — call-time gates still
// apply — never a boot failure.
async function fetchDisabledToolNames(dispatch: FetchDispatch): Promise<ReadonlySet<string>> {
  try {
    const response = await dispatch('/tool-policies', {
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return new Set()
    const body = (await response.json()) as {
      tools?: Array<{ toolName?: string; enabled?: boolean }>
    }
    return new Set(
      (body.tools ?? [])
        .filter((tool) => tool.enabled === false && typeof tool.toolName === 'string')
        .map((tool) => tool.toolName as string),
    )
  } catch {
    // eslint-disable-next-line no-console -- stderr status line (stdout is the MCP channel)
    console.error('[mcp] tool-policy read unreachable — serving the full registry (call-time gates still apply)')
    return new Set()
  }
}

async function main(): Promise<void> {
  const env = loadEnv()
  const dispatch = createFetchDispatch(env.VYNEL_API_URL)
  const disabledToolNames = await fetchDisabledToolNames(dispatch)
  // The committed spec's deep-literal type is a superset of our reader
  // interface; we read only the subset we declare (documented boundary cast).
  const server = buildExternalMcpServer(openApiSpec as unknown as OpenApiSpec, dispatch, {
    disabledToolNames,
  })
  await server.connect(new StdioServerTransport())
  // eslint-disable-next-line no-console -- stderr status line (stdout is the MCP channel)
  console.error(`[mcp] external server ready — dispatching to ${env.VYNEL_API_URL}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- adapter boot-error output
  console.error(err)
  // eslint-disable-next-line n/no-process-exit -- non-zero exit on boot failure
  process.exit(1)
})
