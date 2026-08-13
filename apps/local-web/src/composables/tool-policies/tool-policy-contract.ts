// The `/tool-policies` wire vocabulary, derived from the generated SDK
// (x-sdk-name `toolPolicies.list` / `.save` / `.reset`) so the routes stay
// the one source of truth. This file only NAMES the shapes the UI passes
// around, plus the value lists the pickers iterate — `satisfies` pins every
// entry to the generated union, so a renamed kind fails typecheck here.

import type { VynelClient } from "@vynel/sdk";

type ToolPoliciesApi = VynelClient["toolPolicies"];

/** One tool's resolved, admin-merged policy — declared defaults with the
 *  user's overrides applied. `hasOverride` marks that an override row exists
 *  (the matrix renders the "customized" dot); featureKey/capabilityId absent
 *  means ungated. */
export type EffectiveToolPolicy = Awaited<
  ReturnType<ToolPoliciesApi["list"]>
>["tools"][number];

/** PUT body — FULL-REPLACE override semantics: null = inherit the declared
 *  default; 'none' on the gate fields = ungate. An all-null body resets. */
export type SaveToolPolicyBody = Parameters<ToolPoliciesApi["save"]>[1];

export type SessionSurfaceKind = EffectiveToolPolicy["surfaces"][number];

export type ToolCardClass = EffectiveToolPolicy["cardClass"];

export const SESSION_SURFACE_KINDS = [
  "global-interactive",
  "global-channel",
  "workspace-interactive",
  "workspace-background",
  "delegated-workspace",
  "delegated-global",
  "spawned",
  "agent",
  "schedule",
] as const satisfies readonly SessionSurfaceKind[];

export const TOOL_CARD_CLASSES = [
  "never",
  "ask",
  "always",
] as const satisfies readonly ToolCardClass[];
