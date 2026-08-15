// The /admin/tool-policy surface end-to-end over PGlite: rides the admin
// chain's dual-door gate (unauthenticated refused), edits round-trip, the
// error envelope carries typed codes, and /map serves the versioned export
// the desktop release build downloads.

import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import pino from "pino";
import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { withTestCloudDatabase } from "@vynel/cloud-db/testing";
import type { CloudDatabase } from "@vynel/cloud-db";
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
} from "@vynel/accounts";
import { createInMemoryArtifactStore } from "@vynel/registry";
import { createCloudApp } from "../app.js";

const ADMIN = "test-admin-token-0123456789abcdef-0123456789abcdef";
const silentLogger = pino({ level: "silent" });

let accessTokens: AccessTokenIssuer;
let accessTokenVerifier: AccessTokenVerifier;
let entitlements: EntitlementTokenIssuer;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  accessTokens = await createAccessTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    ttlSeconds: 3600,
  });
  accessTokenVerifier = await createAccessTokenVerifier({
    publicKeyPem: await exportSPKI(publicKey),
  });
  entitlements = await createEntitlementTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    keyId: "k",
  });
});

function buildApp(db: CloudDatabase): Hono {
  return createCloudApp({
    db,
    logger: silentLogger,
    accessTokens,
    accessTokenVerifier,
    entitlements,
    mail: { sendSetPasswordLink: async () => {} },
    artifactStore: createInMemoryArtifactStore(),
    desktopReleases: { resolveUpdate: async () => null },
    linkBaseUrl: "https://hub.test",
    adminToken: ADMIN,
  });
}

const jsonInit = (body: unknown, method = "PUT") => ({
  method,
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${ADMIN}`,
  },
  body: JSON.stringify(body),
});
const auth = { headers: { authorization: `Bearer ${ADMIN}` } };

const INHERIT_ALL = {
  enabled: null,
  cardClass: null,
  surfaces: null,
  featureKey: null,
  capabilityId: null,
};

describe("/admin/tool-policy", () => {
  it("refuses the door without admin credentials", async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db);
      expect((await app.request("/admin/tool-policy")).status).toBe(401);
      expect(
        (
          await app.request("/admin/tool-policy/mcp__vynel__list_tasks", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...INHERIT_ALL, enabled: false }),
          })
        ).status,
      ).toBe(401);
    });
  });

  it("PUT → GET round-trips; DELETE resets; /map versions the content", async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db);

      const put = await app.request(
        "/admin/tool-policy/mcp__vynel__list_tasks",
        jsonInit({ ...INHERIT_ALL, enabled: false, cardClass: "always" }),
      );
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({
        default: {
          ...INHERIT_ALL,
          toolName: "mcp__vynel__list_tasks",
          enabled: false,
          cardClass: "always",
        },
      });

      const list = await app.request("/admin/tool-policy", auth);
      expect(
        ((await list.json()) as { defaults: unknown[] }).defaults,
      ).toHaveLength(1);

      const map = await app.request("/admin/tool-policy/map", auth);
      const mapBody = (await map.json()) as {
        version: string;
        defaults: unknown[];
      };
      expect(mapBody.version).toMatch(/^[0-9a-f]{64}$/);
      expect(mapBody.defaults).toHaveLength(1);

      const del = await app.request(
        "/admin/tool-policy/mcp__vynel__list_tasks",
        {
          method: "DELETE",
          headers: auth.headers,
        },
      );
      expect(del.status).toBe(200);
      const afterDelete = await app.request("/admin/tool-policy", auth);
      expect(
        ((await afterDelete.json()) as { defaults: unknown[] }).defaults,
      ).toEqual([]);
    });
  });

  it("maps typed errors to the envelope: unknown tool 404, bad vocabulary 400", async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db);

      const unknownTool = await app.request(
        "/admin/tool-policy/mcp__vynel__made_up_tool",
        jsonInit({ ...INHERIT_ALL, enabled: false }),
      );
      expect(unknownTool.status).toBe(404);

      const badParam = await app.request(
        "/admin/tool-policy/not-a-tool-name",
        jsonInit({ ...INHERIT_ALL, enabled: false }),
      );
      expect(badParam.status).toBe(400);

      const badFeature = await app.request(
        "/admin/tool-policy/mcp__vynel__list_tasks",
        jsonInit({ ...INHERIT_ALL, featureKey: "not-a-feature" }),
      );
      expect(badFeature.status).toBe(400);

      const badBody = await app.request(
        "/admin/tool-policy/mcp__vynel__list_tasks",
        jsonInit({ enabled: "yes" }),
      );
      expect(badBody.status).toBe(400);
    });
  });
});
