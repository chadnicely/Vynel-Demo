// The operator tool-policy defaults — the hub-side core the /admin/tool-policy
// routes call. Semantic validation happens HERE, against the contracts
// catalog snapshot (the hub must never import the product's engine): a
// default may only target a tool that exists, and its gate fields may only
// name feature keys / capability ids that appear somewhere in the declared
// catalog (or 'none' = ungate). An all-null save normalizes to a delete —
// the declared world stays the single source of truth.

import { createHash } from "node:crypto";
import { NotFoundError, ValidationError } from "@vynel/errors";
import type { CloudDatabase } from "@vynel/cloud-db";
import { TOOL_CATALOG_SNAPSHOT } from "@vynel/contracts/generated/tool-catalog-snapshot";
import { SESSION_SURFACE_KINDS } from "@vynel/contracts/tool-policy/catalog";
import type {
  ToolPolicyDefault,
  ToolPolicyMapExport,
} from "@vynel/contracts/tool-policy/defaults";
import {
  deleteToolPolicyDefaultRow,
  listToolPolicyDefaultRows,
  upsertToolPolicyDefaultRow,
} from "./repositories/tool-policy-defaults-repository.js";
import type { ToolPolicyDefaultRow } from "./schema/tool-policy-defaults.js";

const KNOWN_TOOL_NAMES = new Set(
  TOOL_CATALOG_SNAPSHOT.map((entry) => entry.toolName),
);
const KNOWN_FEATURE_KEYS = new Set(
  TOOL_CATALOG_SNAPSHOT.flatMap((entry) =>
    entry.featureKey ? [entry.featureKey] : [],
  ),
);
const KNOWN_CAPABILITY_IDS = new Set(
  TOOL_CATALOG_SNAPSHOT.flatMap((entry) =>
    entry.capabilityId ? [entry.capabilityId] : [],
  ),
);

// Canonical surface storage — declared order, deduped. Without this a UI
// resending the same set in a different order would flip the map's
// content-hash version with zero semantic change.
function canonicalSurfaces(surfaces: readonly string[]): string[] {
  const sent = new Set(surfaces);
  return SESSION_SURFACE_KINDS.filter((kind) => sent.has(kind));
}

function toDto(row: ToolPolicyDefaultRow): ToolPolicyDefault {
  return {
    toolName: row.toolName,
    enabled: row.enabled,
    cardClass: row.cardClass,
    surfaces: (row.surfacesJson as ToolPolicyDefault["surfaces"]) ?? null,
    featureKey: row.featureKey,
    capabilityId: row.capabilityId,
  };
}

export async function listToolPolicyDefaults(
  db: CloudDatabase,
): Promise<ToolPolicyDefault[]> {
  return (await listToolPolicyDefaultRows(db)).map(toDto);
}

/** Full-replace save. All-null fields = reset (row deleted, returns null). */
export async function setToolPolicyDefault(
  db: CloudDatabase,
  input: ToolPolicyDefault,
): Promise<ToolPolicyDefault | null> {
  // Reset FIRST, known-tool check after: a row whose tool later left the
  // catalog snapshot must stay deletable, or it bakes into every future
  // release with no API path to purge it.
  const allNull =
    input.enabled === null &&
    input.cardClass === null &&
    input.surfaces === null &&
    input.featureKey === null &&
    input.capabilityId === null;
  if (allNull) {
    await deleteToolPolicyDefaultRow(db, input.toolName);
    return null;
  }

  if (!KNOWN_TOOL_NAMES.has(input.toolName)) {
    throw new NotFoundError("catalog tool", input.toolName);
  }
  if (
    input.featureKey !== null &&
    input.featureKey !== "none" &&
    !KNOWN_FEATURE_KEYS.has(input.featureKey)
  ) {
    throw new ValidationError(
      `unknown featureKey '${input.featureKey}' — use a declared hub feature key or 'none'`,
    );
  }
  if (
    input.capabilityId !== null &&
    input.capabilityId !== "none" &&
    !KNOWN_CAPABILITY_IDS.has(input.capabilityId)
  ) {
    throw new ValidationError(
      `unknown capabilityId '${input.capabilityId}' — use a declared capability id or 'none'`,
    );
  }

  const row = await upsertToolPolicyDefaultRow(db, {
    toolName: input.toolName,
    enabled: input.enabled,
    cardClass: input.cardClass,
    surfacesJson:
      input.surfaces === null ? null : canonicalSurfaces(input.surfaces),
    featureKey: input.featureKey,
    capabilityId: input.capabilityId,
  });
  return toDto(row);
}

/** The downloadable map a desktop release bakes in. `version` is the sha256
 *  of the canonical defaults JSON — identical maps always hash identically
 *  (rows arrive toolName-sorted from the repo; DTO field order is fixed). */
export async function resolveToolPolicyMapExport(
  db: CloudDatabase,
): Promise<ToolPolicyMapExport> {
  // Codepoint re-sort in JS: the repo's SQL orderBy follows the DB's text
  // collation, which varies across deployments — the hash must not.
  const defaults = (await listToolPolicyDefaults(db)).sort((a, b) =>
    a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0,
  );
  const version = createHash("sha256")
    .update(JSON.stringify(defaults))
    .digest("hex");
  return { version, generatedAt: new Date().toISOString(), defaults };
}
