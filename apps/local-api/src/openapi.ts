// Local wrapper around `hono-openapi`'s `describeRoute` that widens the
// metadata type to allow the `x-mcp` extension. Every route file in
// `apps/local-api/src/routes/<d>/` imports `describeRoute` from HERE, NOT from
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
  /**
   * Card this tool in ASK mode even though its method is not DELETE. DELETE
   * routes join the generator's ask-approval set automatically (approval is
   * for "DELETE and anything destructive"); this flag opts in a non-DELETE
   * route — a destructive POST/PATCH, or one the user wants carded regardless
   * (register_workspace). Auto/bypass run these tools uncarded.
   */
  askApproval?: boolean
  /**
   * Route this tool to the GLOBAL-ROOT ("brain") surface instead of the
   * workspace surface. The generator's default split is path-based
   * (`/routing/*` → the root's toolset); a user-scoped brain tool that doesn't
   * live under `/routing/` (e.g. registering a workspace) sets this to `true`.
   */
  rootSurface?: boolean
  /**
   * ALSO expose this tool on WORKSPACE INTERACTIVE chat streams (session-library
   * Slice ④b): the tool keeps whatever surface the path/rootSurface split gives
   * it AND joins `generatedWorkspaceInteractiveMcpTools` — composed only by
   * `vynelWorkspaceInteractiveDescriptor` (streams/chat-turn.ts). Background
   * workspace turns (schedule fires, delegated runs) compose the plain workspace
   * descriptor and never see these tools.
   */
  workspaceInteractiveSurface?: boolean
  /**
   * Body fields the emitted MCP tool must NOT advertise or forward — the
   * structural half of "secrets never transit chat": a field collecting
   * user-supplied secret values (install configuration) exists for the UI
   * surface only, and the generated tool's schema simply has no such
   * parameter (a model-invented value is stripped by the tool's zod
   * object before the HTTP call). The route still validates for every
   * surface.
   */
  excludedBodyFields?: string[]
  /**
   * ALSO keep this ROOT tool in the plain workspace array. Routing and workspace
   * are otherwise mutually exclusive (`nonRouting = !isRouting` in the
   * generator), so one route cannot serve both the global root and the turns
   * that read the plain array (schedule fires, spawned sessions, delegated
   * workspace roots). Correct for a genuinely root-only tool; wrong for one
   * every session needs — a unified comms tool must have ONE name everywhere,
   * or the model has to choose between near-identical tools and choosing wrong
   * is a silent misroute rather than an error.
   */
  workspaceSurface?: boolean
}

// The `hono-openapi` describeRoute accepts a wide options object plus
// arbitrary extension keys; we tighten the input to allow `x-mcp` while
// preserving every other field. Output type pass-through keeps the
// middleware-handler inference that downstream routes rely on.
type DescribeRouteOptions = Parameters<typeof honoDescribeRoute>[0] & {
  'x-mcp'?: McpExtension
  /**
   * Dotted `namespace.method` name for the generated namespaced SDK
   * (`x-sdk-name: 'knowledge.search'` → `client.knowledge.search()`).
   * Optional at the type level so the annotation sweep can land in
   * stages; `generate-namespaced-sdk.ts` enforces required-in-practice
   * (it throws on any route missing it).
   */
  'x-sdk-name'?: string
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
