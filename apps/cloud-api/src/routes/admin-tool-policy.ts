// The operator tool-policy surface — the cloud-admin portal edits the global
// per-tool defaults here, and the desktop RELEASE BUILD downloads the
// resolved map from /map to bake it into the app (a change ships with the
// next version; there is deliberately no runtime fetch). Admin-gated
// end-to-end: the map carries no secrets, but policy authorship is operator
// power. Thin per invariant #4 — semantic validation (tool exists, gate
// vocabulary) lives in `@vynel/registry`'s core.

import { Hono } from "hono";
import { ValidationError } from "@vynel/errors";
import {
  listToolPolicyDefaults,
  resolveToolPolicyMapExport,
  setToolPolicyDefault,
} from "@vynel/registry";
import {
  TOOL_NAME_PATTERN,
  ToolPolicyDefaultFieldsSchema,
} from "@vynel/contracts/tool-policy/defaults";
import type { CloudAppOptions } from "../cloud-app-options.js";
import { jsonValidator } from "../middleware/json-validator.js";

function requireToolNameParam(raw: string): string {
  if (!TOOL_NAME_PATTERN.test(raw)) {
    throw new ValidationError(
      `invalid tool name '${raw}' — expected the full mcp__<server>__<tool> form`,
    );
  }
  return raw;
}

/** Mounted INSIDE `buildAdminRoutes` at `/tool-policy` — the parent chain's
 *  `requireAdminAccess` use('*') is the one gate; adding another here would
 *  run the fresh role read twice per request. */
export function buildAdminToolPolicyRoutes(options: CloudAppOptions) {
  return new Hono()
    .get("/", async (c) => {
      const defaults = await listToolPolicyDefaults(options.db);
      return c.json({ defaults });
    })
    .get("/map", async (c) => {
      const map = await resolveToolPolicyMapExport(options.db);
      return c.json(map);
    })
    .put(
      "/:toolName",
      jsonValidator(ToolPolicyDefaultFieldsSchema),
      async (c) => {
        const toolName = requireToolNameParam(c.req.param("toolName"));
        const saved = await setToolPolicyDefault(options.db, {
          toolName,
          ...c.req.valid("json"),
        });
        // null = the all-null save normalized to a reset.
        return c.json({ default: saved });
      },
    )
    .delete("/:toolName", async (c) => {
      const toolName = requireToolNameParam(c.req.param("toolName"));
      await setToolPolicyDefault(options.db, {
        toolName,
        enabled: null,
        cardClass: null,
        surfaces: null,
        featureKey: null,
        capabilityId: null,
      });
      return c.json({ default: null });
    });
}
