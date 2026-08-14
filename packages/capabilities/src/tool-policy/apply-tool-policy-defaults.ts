// The BAKED operator-defaults layer — a pure catalog transform sitting
// between the code-declared defaults and the user's own overrides:
//
//   code catalog  →  baked cloud map (this)  →  user tool_policies rows
//
// A desktop release downloads the operator map at BUILD time and ships it
// beside the app (no runtime fetch — a change distributes with the next
// version). Each field follows the house inherit semantics: null = keep the
// declared value, 'none' on a gate field = ungate. A default naming a tool
// this build's catalog doesn't declare is inert — the catalog is the roster,
// exactly as with user override rows.

import type { ToolPolicyDefault } from "@vynel/contracts/tool-policy/defaults";
import {
  filterKnownSurfaceKinds,
  TOOL_POLICY_UNGATED,
} from "./resolve-effective-tool-policies.js";
import type { ToolCatalogEntry } from "./tool-policy-types.js";

export function applyToolPolicyDefaultsToCatalog(
  catalog: readonly ToolCatalogEntry[],
  defaults: readonly ToolPolicyDefault[],
): readonly ToolCatalogEntry[] {
  if (defaults.length === 0) return catalog;
  const byTool = new Map(
    defaults.map((baked) => [baked.toolName, baked] as const),
  );

  return catalog.map((entry) => {
    const baked = byTool.get(entry.toolName);
    if (baked === undefined) return entry;

    const featureKey =
      baked.featureKey === TOOL_POLICY_UNGATED
        ? undefined
        : (baked.featureKey ?? entry.featureKey);
    const capabilityId =
      baked.capabilityId === TOOL_POLICY_UNGATED
        ? undefined
        : (baked.capabilityId ?? entry.capabilityId);
    const defaultEnabled = baked.enabled ?? entry.defaultEnabled;

    // Every field enumerated deliberately (the ungate cases must OMIT keys,
    // so no spread) — a new ToolCatalogEntry field must be added here too.
    return {
      toolName: entry.toolName,
      serverName: entry.serverName,
      surfaces:
        baked.surfaces === null
          ? entry.surfaces
          : filterKnownSurfaceKinds(baked.surfaces),
      cardClass: baked.cardClass ?? entry.cardClass,
      ...(featureKey !== undefined ? { featureKey } : {}),
      ...(capabilityId !== undefined ? { capabilityId } : {}),
      ...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
    };
  });
}
