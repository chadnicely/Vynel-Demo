// Display vocabulary for the Tool Policy matrix — the one home for how the
// wire unions read on screen; the row chips and the edit dialog's selects
// both draw from here.

import {
  ALL_FEATURE_KEYS,
  type HubFeatureKey,
} from "@vynel/contracts/hub/entitlements";
import type { WorkspaceCapabilityId } from "../../../composables/capabilities/use-workspace-capabilities.js";
import type {
  SessionSurfaceKind,
  ToolCardClass,
} from "../../../composables/tool-policies/tool-policy-contract.js";

export const SURFACE_LABELS: Record<SessionSurfaceKind, string> = {
  "global-interactive": "Global chat",
  "global-channel": "Channels",
  "workspace-interactive": "Workspace chat",
  "workspace-background": "Workspace background",
  "delegated-workspace": "Delegated (workspace)",
  "delegated-global": "Delegated (global)",
  spawned: "Spawned sessions",
  agent: "Agents",
  schedule: "Schedules",
};

export const CARD_CLASS_LABELS: Record<ToolCardClass, string> = {
  never: "Never",
  ask: "Ask",
  always: "Always",
};

const FEATURE_KEY_LABELS: Record<HubFeatureKey, string> = {
  channels: "Channels",
  voice: "Voice",
  schedules: "Schedules",
  knowledge: "Knowledge",
  memory: "Memory",
  marketplace: "Marketplace",
  apps: "Apps",
  ssh: "SSH",
};

export interface TierOption {
  id: HubFeatureKey | "none";
  label: string;
}

export const TIER_OPTIONS: TierOption[] = [
  { id: "none", label: "Free (none)" },
  ...ALL_FEATURE_KEYS.map((key) => ({ id: key, label: FEATURE_KEY_LABELS[key] })),
];

export interface CapabilityOption {
  id: WorkspaceCapabilityId | "none";
  label: string;
}

// Mirrors the capability catalog's display names — the dialog also serves the
// GLOBAL surface, where no workspace capability list is fetched to read them
// from.
export const CAPABILITY_OPTIONS: CapabilityOption[] = [
  { id: "none", label: "None" },
  { id: "memory", label: "Memory" },
  { id: "knowledge", label: "Knowledge" },
  { id: "notebook", label: "Notebook" },
  { id: "tasks", label: "Tasks" },
  { id: "plans", label: "Plans" },
  { id: "phases", label: "Phases" },
  { id: "features", label: "Features" },
  { id: "journal", label: "Journal" },
];

/** `mcp__<server>__<tool>` reads as noise in a list — the UI shows the bare
 *  tool name and keeps the full key on a title attr. */
export function shortToolNameOf(tool: {
  toolName: string;
  serverName: string;
}): string {
  const prefix = `mcp__${tool.serverName}__`;
  return tool.toolName.startsWith(prefix)
    ? tool.toolName.slice(prefix.length)
    : tool.toolName;
}

/** Narrow an effective row's open-text featureKey to a known tier key — the
 *  entitlement lock check needs the union; unknown text still renders as a
 *  chip but can never lock. */
export function asHubFeatureKey(
  value: string | undefined,
): HubFeatureKey | null {
  return value !== undefined &&
    (ALL_FEATURE_KEYS as readonly string[]).includes(value)
    ? (value as HubFeatureKey)
    : null;
}

export function featureKeyLabelOf(featureKey: string): string {
  const known = asHubFeatureKey(featureKey);
  return known !== null ? FEATURE_KEY_LABELS[known] : featureKey;
}

export function capabilityLabelOf(capabilityId: string): string {
  return (
    CAPABILITY_OPTIONS.find((option) => option.id === capabilityId)?.label ??
    capabilityId
  );
}
