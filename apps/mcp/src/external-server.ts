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
// (+ query); we resolve it against the api base URL. Phase-1 single-user: the
// api resolves the local user server-side, so there's no auth header here.
function createFetchDispatch(apiUrl: string): FetchDispatch {
  return (url, init) => fetch(new URL(url, apiUrl), init)
}

async function main(): Promise<void> {
  const env = loadEnv()
  // The committed spec's deep-literal type is a superset of our reader
  // interface; we read only the subset we declare (documented boundary cast).
  const server = buildExternalMcpServer(
    openApiSpec as unknown as OpenApiSpec,
    createFetchDispatch(env.VYNEL_API_URL),
  )
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
