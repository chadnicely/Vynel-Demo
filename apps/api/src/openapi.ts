// Local wrapper around `hono-openapi`'s `describeRoute` that widens the
// metadata type to allow the `x-mcp` extension. Every route file in
// `apps/api/src/routes/<d>/` imports `describeRoute` from HERE, NOT from
// `hono-openapi` directly. Per `.claude/rules/coding-standard.md`
// "Hono routes" + `.claude/rules/sdk-mcp.md` "MCP opt-in protocol".
//
// Also exports `openApiInfo`, the OpenAPI 3.1 document metadata passed
// to `openAPISpecs(app, openApiInfo)` in `app.ts` for the
// `/openapi.json` mount. `scripts/src/generators/generate-sdk.ts`
// dispatches `app.request('/openapi.json')` against an in-memory app to
// walk sub-app routes — the `app-request-spec-trick` letterman locked
// (`generateSpecs(app)` does not flatten routes mounted via
// `.route(...)`). Per
// `.claude/memory/decisions/apps-web-foundation-design.md`.

import { describeRoute as honoDescribeRoute, type OpenApiSpecsOptions } from 'hono-openapi'

export interface McpExtension {
  exposed: boolean
  name?: string
  description?: string
  /**
   * Mutating tools (POST/PATCH/PUT/DELETE) MUST set this to `true`
   * before the generator emits them — defense in depth per
   * `docs/blueprints/mcp/decisions.md` D7 + Q8 (spelling resolved
   * 2026-05-25 = `mutatingApproved`). Setting it implicitly attests
   * to the per-route scope review `sdk-mcp.md` requires.
   */
  mutatingApproved?: boolean
}

// The `hono-openapi` describeRoute accepts a wide options object plus
// arbitrary extension keys; we tighten the input to allow `x-mcp` while
// preserving every other field. Output type pass-through keeps the
// middleware-handler inference that downstream routes rely on.
type DescribeRouteOptions = Parameters<typeof honoDescribeRoute>[0] & {
  'x-mcp'?: McpExtension
}

export const describeRoute: (
  options: DescribeRouteOptions,
) => ReturnType<typeof honoDescribeRoute> = honoDescribeRoute as never

export const openApiInfo: OpenApiSpecsOptions = {
  documentation: {
    openapi: '3.1.0',
    info: {
      title: 'Vynel API',
      version: '0.1.0',
      description:
        'Vynel — desktop AI assistant for non-technical knowledge ' +
        'workers. Phase 1 ships locally; single-user.',
    },
  },
}
