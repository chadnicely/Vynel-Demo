import type {
  SessionSurfaceKind,
  ToolCardClass,
  ToolCatalogEntry,
} from "@vynel/contracts/tool-policy/catalog";
import type { ToolPolicyDefault } from "@vynel/contracts/tool-policy/defaults";

/** One row of the matrix: the declared entry, the hub override (null when
 *  the tool runs on pure declared defaults), and the overlay of the two —
 *  what a release build would actually bake for this tool. */
export type EffectiveToolRow = {
  entry: ToolCatalogEntry;
  override: ToolPolicyDefault | null;
  effective: {
    enabled: boolean;
    cardClass: ToolCardClass;
    surfaces: readonly SessionSurfaceKind[];
    // null = ungated (either declared that way or overridden to 'none').
    featureKey: string | null;
    capabilityId: string | null;
  };
};

export type ToolServerGroup = {
  serverName: string;
  rows: EffectiveToolRow[];
};

// 'none' is the wire's explicit-ungate sentinel — effectively no gate.
function resolveGate(
  overrideValue: string | null | undefined,
  declared: string | undefined,
): string | null {
  if (overrideValue === "none") return null;
  return overrideValue ?? declared ?? null;
}

export function resolveEffectiveTool(
  entry: ToolCatalogEntry,
  override: ToolPolicyDefault | null,
): EffectiveToolRow {
  return {
    entry,
    override,
    effective: {
      // A tool is on unless an override says otherwise — the snapshot
      // declares no per-tool enabled flag.
      enabled: override?.enabled ?? true,
      cardClass: override?.cardClass ?? entry.cardClass,
      surfaces: override?.surfaces ?? entry.surfaces,
      featureKey: resolveGate(override?.featureKey, entry.featureKey),
      capabilityId: resolveGate(override?.capabilityId, entry.capabilityId),
    },
  };
}

/** The snapshot arrives sorted by (serverName, toolName) — grouping just
 *  slices it into contiguous server sections in that same order. */
export function groupToolsByServer(
  snapshot: readonly ToolCatalogEntry[],
  overrides: readonly ToolPolicyDefault[],
): ToolServerGroup[] {
  const overrideByTool = new Map(overrides.map((o) => [o.toolName, o]));
  const groups: ToolServerGroup[] = [];
  for (const entry of snapshot) {
    const row = resolveEffectiveTool(
      entry,
      overrideByTool.get(entry.toolName) ?? null,
    );
    const group = groups.at(-1);
    if (group?.serverName === entry.serverName) group.rows.push(row);
    else groups.push({ serverName: entry.serverName, rows: [row] });
  }
  return groups;
}

/** The capability vocabulary the edit form offers — derived from the
 *  snapshot because contracts exports no standalone capability-id list. */
export function snapshotCapabilityIds(
  snapshot: readonly ToolCatalogEntry[],
): string[] {
  const ids = new Set<string>();
  for (const entry of snapshot) {
    if (entry.capabilityId !== undefined) ids.add(entry.capabilityId);
  }
  return [...ids].sort();
}

/** The bare tool name (`list_apps`) — rows stay compact; the full wire name
 *  rides in the row's tooltip. */
export function shortToolName(toolName: string): string {
  const lastSeparator = toolName.lastIndexOf("__");
  return lastSeparator === -1 ? toolName : toolName.slice(lastSeparator + 2);
}
