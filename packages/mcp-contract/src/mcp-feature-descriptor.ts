// The MCP feature-attachment contract — the ONE shape every MCP-tool surface
// implements so it can be composed into a turn uniformly. Two producers
// implement it today: the route-derived `vynel` server (apps/mcp, hand-written
// descriptors wrapping the generated tool arrays) and the standalone `desktop`
// server (@vynel/desktop-control). A future feature (voice, memory-as-library)
// ships its own descriptor and plugs in with no turn-entry-point edits.
//
// DEPENDENCY-LIGHT BY DESIGN. This package depends on NOTHING from `@vynel/*`
// (only the SDK's server type, type-only). That's what lets the core-free
// `@vynel/desktop-control` implement the contract without taking on
// `@vynel/db` / `@vynel/core`. The heavy context fields (`db`, `desktopReader`)
// are typed `unknown` here; each producer narrows the one field it owns with a
// single documented cast at its own boundary. The composer that consumes these
// descriptors lives at the apps/local-api layer (NOT core — the locked
// `api-side-turn-execution-with-mcp` decision keeps core below the producers).

import type { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'

// The built in-process MCP server — the Claude Agent SDK's `createSdkMcpServer`
// return shape. Matches the `ReturnType<typeof createSdkMcpServer>` idiom both
// producers already use at their `build*` boundaries.
export type SessionMcpServer = ReturnType<typeof createSdkMcpServer>

// Hono's `app.request(input, init)` surface — declared structurally here so the
// contract stays free of any `@vynel`/Hono dependency. Structurally identical to
// `apps/local-api/src/factory.ts`'s `HonoAppRequestFn`, `apps/mcp`'s, and core's
// `AppRequestFn`. Tool handlers dispatch through it (the in-process equivalent
// of "wrap the API via HTTP, never call core directly").
export type HonoAppRequestFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response>

// How a proposed desktop plan acquires authority for the turn — derived from
// the turn's permission mode by the desktop producer's `deriveDesktopPlanConsent`
// and threaded here so the turn entry-points stay mode-vocabulary-free:
//   'approval-card'    the plan raised an approval card; approval IS the consent
//   'standing-consent' the user's auto/bypass mode is the standing consent
//   'display-only'     unattended turn — the plan narrates but never authorizes
//                      (standing per-app grants remain the only authority)
export type DesktopPlanConsent = 'approval-card' | 'standing-consent' | 'display-only'

// The per-turn deps a feature's `build(context)` may read. Structural +
// dependency-light: `db` and `desktopReader` are `unknown` so a producer
// package implements the contract WITHOUT importing `@vynel/db` or
// cross-importing another feature's package — each casts the field it owns.
export interface SessionToolContext {
  /** The request-scoped Drizzle database. `unknown` here — the `vynel` producer casts to `Database`. */
  readonly db: unknown
  readonly userId: string
  /** Absent for workspace-scope-free turns (the global root has no workspace). */
  readonly workspaceId?: string
  /**
   * VYNEL's own stable session id for the turn — the `primary_sessions` row id,
   * NEVER the SDK's session id. The SDK id cannot serve here: on the global-root
   * path the runtime assigns it mid-stream, after this context is already built.
   * Absent when the caller has no stable identity at build time (a schedule
   * fire starting a fresh session); features that key per-task records on it
   * (the desktop action log) then record without one.
   */
  readonly sessionId?: string
  readonly appRequest: HonoAppRequestFn
  /** The process-wide desktop-notification reader. `unknown` here — the `desktop` producer casts it. */
  readonly desktopReader?: unknown
  /** Whether the mutating desktop `act_on_app` tool is enabled (default-off env flag). */
  readonly enableDesktopActions?: boolean
  /** How a proposed desktop plan acquires authority this turn (absent → 'display-only'). */
  readonly desktopPlanConsent?: DesktopPlanConsent
}

export interface McpFeatureDescriptor {
  // The server key — becomes the `mcp__<serverName>__*` tool prefix.
  readonly serverName: string

  // Build this feature's in-process server for the turn. Returns `null` when the
  // feature is not applicable here (e.g. desktop with no listener running).
  build(context: SessionToolContext): SessionMcpServer | null

  // Tools whose effects are irreversible enough to require an approval card EVEN
  // under a bypass permission mode. The composer UNIONS these into the approval
  // backstop — ADDITIVE only (it never removes the static native floor in
  // `@vynel/providers`). A feature that ships a destructive tool declares it
  // once here and it cards automatically.
  readonly mutatingToolNames: readonly string[]

  // Tools that card ONLY in ask mode (the ask-approval tier: deletes, purges,
  // and tools the user explicitly wants carded — register_workspace, the desktop
  // act tools). In auto/bypass these run uncarded — Chad's approval stance
  // (2026-07-26): "ask mode gates through approval; auto and bypass, no
  // approval." A tool that must card in EVERY mode belongs in
  // `mutatingToolNames` instead; the two sets are disjoint tiers, not
  // overlapping ones. Omit when none.
  readonly askModeApprovalToolNames?: readonly string[]

  // Tools denied when their capability is OFF: capabilityId → tool names. The
  // `vynel` server is multi-capability (memory + knowledge tools alongside
  // ungated ones), so a single per-server gate can't express it — this map is
  // the relocated `CAPABILITY_MCP_TOOLS`. Keys are capability id STRINGS; the
  // apps/local-api composer maps them to the typed `CapabilityId` enabled-set.
  // Omit when none of the feature's tools are capability-gated.
  readonly capabilityGatedTools?: Readonly<Record<string, readonly string[]>>

  // The feature's FULL tool inventory (`mcp__<server>__<tool>` names) — the
  // legible surface the policy catalog and the admin matrix read; the built
  // server stays the executable truth. Vynel's descriptors DERIVE theirs from
  // the generated registry (no drift possible); hand-built servers declare
  // theirs and pin them with a colocated test. Optional only until every
  // descriptor carries it — new descriptors should always declare it.
  readonly toolNames?: readonly string[]

  // The TIER twin of `capabilityGatedTools`: tools denied when the user's hub
  // entitlement lacks the feature key (basic vs pro). Keys are `HubFeatureKey`
  // STRINGS (`@vynel/contracts/hub/entitlements` — kept untyped here so this
  // contract stays dependency-light; the apps/mcp pin test holds the keys to
  // the real union). Filtering at COMPOSITION is what makes an out-of-tier
  // tool invisible to the model instead of a 403 at call time — and it is the
  // only tier gate that reaches descriptors whose handlers never re-enter
  // HTTP (ssh, desktop, notebook, ask, study). The HTTP `featureGate`
  // middleware stays as the UI door + defense in depth. Omit when none.
  readonly featureGatedTools?: Readonly<Record<string, readonly string[]>>

  // CORE-CAPABILITY tier seam (future memory/knowledge direction): when `true`
  // the composer (1) never denies this feature's tools via the capability gate,
  // and (2) keeps its tools OUT of the mutating set regardless of mode — so a
  // core capability is always-on + no-approval + mode-independent. The flag
  // exists now; it is NOT set on any feature yet (the tier is wired the day the
  // owner builds it). See `[[vynel-capability-approval-model]]`.
  readonly alwaysOn?: boolean

  // Optional system-prompt addition for a feature whose prompt is SELF-CONTAINED.
  // Concatenated into the composed `systemPromptAppend`. NOT for the global root's
  // own base prompt or memory's snapshot — those stay with their owners (avoids
  // coupling a feature package to apps/local-api concepts / memory-core).
  //
  // `enabledCapabilityIds` is the turn's enabled-capability set (the same one
  // the composer gates tools with). A MULTI-capability descriptor (the `vynel`
  // server) needs it to drop one capability's prompt section while another's
  // tools stay live — the composer's own skip is all-or-nothing per descriptor,
  // so it can't express that. Single-capability descriptors just ignore it.
  contributePrompt?(
    context: SessionToolContext,
    enabledCapabilityIds?: ReadonlySet<string>,
  ): string | null

  // Defense-in-depth predicate — when it returns `false` the feature is skipped
  // entirely (a cheap pre-check that avoids building a server that won't be used).
  // Distinct from `build` returning `null`; either path excludes the feature.
  isApplicable?(context: SessionToolContext): boolean
}
