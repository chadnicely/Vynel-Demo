// The tool-policy vocabulary every surface shares: the product engine
// (`@vynel/capabilities` re-exports these), the hub's operator-defaults
// routes, and the cloud-admin portal's matrix. Contracts is the one home so
// the wire, the DB unions, and the generated catalog snapshot can never
// disagree.

import { z } from "zod";

/** The consumer kinds a turn can run as — WHERE a tool may attach. Mirrors
 *  the composition sites (the session-tool-catalog owns which descriptors
 *  each kind composes; per-tool surface overrides refine within that). */
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
] as const;

export type SessionSurfaceKind = (typeof SESSION_SURFACE_KINDS)[number];

export const SessionSurfaceKindSchema = z.enum(SESSION_SURFACE_KINDS);

/** When a tool cards: `never` = resolve-allow, `ask` = card in the carding
 *  modes (ask/plan-only), `always` = card in every mode that can card. */
export const TOOL_CARD_CLASSES = ["never", "ask", "always"] as const;

export type ToolCardClass = (typeof TOOL_CARD_CLASSES)[number];

export const ToolCardClassSchema = z.enum(TOOL_CARD_CLASSES);

/** One tool's DECLARED defaults. Assembled at the product's app edge from
 *  the descriptors (`toolNames` + gates) and the generated registry's
 *  surface arrays; snapshotted into `catalog-snapshot.ts` for the surfaces
 *  that can't run that assembly (the portal, the hub). */
export type ToolCatalogEntry = {
  readonly toolName: string;
  readonly serverName: string;
  readonly surfaces: readonly SessionSurfaceKind[];
  readonly cardClass: ToolCardClass;
  readonly featureKey?: string;
  readonly capabilityId?: string;
};
