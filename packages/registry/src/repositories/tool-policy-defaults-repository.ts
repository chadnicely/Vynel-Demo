// Functional repo over `tool_policy_defaults` — the operator's global
// per-tool overrides. Full-replace upsert (the row IS the override set);
// delete = reset to the declared catalog default.

import { asc, eq } from "drizzle-orm";
import type { CloudDatabase } from "@vynel/cloud-db";
import {
  toolPolicyDefaults,
  type ToolPolicyDefaultRow,
} from "../schema/tool-policy-defaults.js";

export type ToolPolicyDefaultRowInput = {
  toolName: string;
  enabled: boolean | null;
  cardClass: ToolPolicyDefaultRow["cardClass"];
  surfacesJson: string[] | null;
  featureKey: string | null;
  capabilityId: string | null;
};

export async function listToolPolicyDefaultRows(
  db: CloudDatabase,
): Promise<ToolPolicyDefaultRow[]> {
  return db
    .select()
    .from(toolPolicyDefaults)
    .orderBy(asc(toolPolicyDefaults.toolName));
}

export async function upsertToolPolicyDefaultRow(
  db: CloudDatabase,
  input: ToolPolicyDefaultRowInput,
): Promise<ToolPolicyDefaultRow> {
  const [row] = await db
    .insert(toolPolicyDefaults)
    .values(input)
    .onConflictDoUpdate({
      target: toolPolicyDefaults.toolName,
      set: {
        enabled: input.enabled,
        cardClass: input.cardClass,
        surfacesJson: input.surfacesJson,
        featureKey: input.featureKey,
        capabilityId: input.capabilityId,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (row === undefined)
    throw new Error("tool_policy_defaults upsert returned no row");
  return row;
}

export async function deleteToolPolicyDefaultRow(
  db: CloudDatabase,
  toolName: string,
): Promise<void> {
  await db
    .delete(toolPolicyDefaults)
    .where(eq(toolPolicyDefaults.toolName, toolName));
}
