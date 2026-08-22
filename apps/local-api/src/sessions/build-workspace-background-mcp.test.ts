// Pins the delegated-turn composer's DESCRIPTOR ROUTING (the 2026-07-21
// re-decision of the ④b pin): a workspace-root target composes the INTERACTIVE
// vynel descriptor (session-routing trio included), a spawned-session target
// the plain one — and schedule fires' plain composer never touches the
// interactive descriptor at all. The descriptors are mocked with markers
// because a built SDK server is opaque; the real composition output is covered
// by build-schedule-fire-deps.test.ts against the true registry.

import { describe, expect, it, vi } from "vitest";
import type { Database } from "@vynel/db";
import { withTestDatabase } from "@vynel/testing";
import { insertUser, upsertPreferenceForUser } from "@vynel/db/repositories/users";

vi.mock("@vynel/mcp", () => ({
  vynelWorkspaceDescriptor: {
    serverName: "vynel-plain",
    // Captures the dispatcher the composer hands the descriptor — the
    // caller-header tests below drive a request through it.
    build: (context: { appRequest: unknown }) => ({
      marker: "plain",
      appRequest: context.appRequest,
    }),
    mutatingToolNames: [],
  },
  vynelWorkspaceInteractiveDescriptor: {
    serverName: "vynel-interactive",
    build: (context: { appRequest: unknown }) => ({
      marker: "interactive",
      appRequest: context.appRequest,
    }),
    mutatingToolNames: [],
  },
  // A GLOBAL-grounded spawned session inherits the ROOT's toolset (2026-07-26).
  vynelRoutingDescriptor: {
    serverName: "vynel-routing",
    build: (context: { appRequest: unknown }) => ({
      marker: "routing",
      appRequest: context.appRequest,
    }),
    mutatingToolNames: [],
  },
}));
vi.mock("@vynel/instructions", () => ({
  notebookFeatureDescriptor: {
    serverName: "vynel-notebook",
    build: () => ({ marker: "notebook" }),
    mutatingToolNames: [],
  },
}));
// whoami rides every background producer (continuity arc Slice 3). The marker
// captures the identity the composer hands it — the stable primary id —
// which is what the tool answers from.
vi.mock("@vynel/session/mcp", () => ({
  buildSessionFeatureDescriptor: () => ({
    serverName: "vynel-session",
    build: (context: { sessionId?: string }) => ({
      marker: "session",
      sessionId: context.sessionId,
    }),
    mutatingToolNames: [],
  }),
}));
// The workspace-root target's identity is the workspace's own primary; the
// stub db can't answer the real read, so the lookup is pinned here.
vi.mock("@vynel/session/continuity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findPrimaryConversation: () => ({ id: "ws-primary-1" }),
}));
vi.mock("@vynel/capabilities", () => ({
  listEnabledCapabilities: () => [],
  // The global-grounded branch has no workspace row to read — it falls back
  // to the catalog defaults (the same fallback the global-root sites use).
  defaultEnabledCapabilityIds: () => new Set<string>(["notebook"]),
  // The builders resolve admin overrides internally; the db here is a
  // stand-in, so the resolver answers "no overrides".
  resolveEffectiveToolPolicies: () => new Map(),
  // The baked layer passes the catalog through untouched — no map is primed.
  applyToolPolicyDefaultsToCatalog: (catalog: unknown) => catalog,
}));
// Mirrors the real descriptor's applicability gate: it excludes ITSELF when no
// reader was wired at boot, which is what keeps composition safe off-Windows.
vi.mock("@vynel/desktop-control", () => ({
  // Mirrors the real one-home policy (`plan/desktop-plan-consent.ts`): ask
  // cards, the user's own auto/bypass ARE the consent, and anything else —
  // including the unattended default — falls to the conservative floor.
  deriveDesktopPlanConsent: (mode?: string) =>
    mode === "ask"
      ? "approval-card"
      : mode === "auto" || mode === "bypass"
        ? "standing-consent"
        : "display-only",
  desktopFeatureDescriptor: {
    serverName: "desktop",
    build: (context: {
      desktopReader?: unknown;
      desktopPlanConsent?: string;
      enableDesktopActions?: boolean;
      sessionId?: string;
    }) =>
      context.desktopReader === undefined
        ? null
        : {
            marker: "desktop",
            planConsent: context.desktopPlanConsent,
            actionsEnabled: context.enableDesktopActions,
            sessionId: context.sessionId,
          },
    mutatingToolNames: ["mcp__desktop__request_desktop_access"],
  },
}));

import {
  buildDelegatedTurnMcpComposer,
  buildWorkspaceBackgroundMcpComposer,
} from "./build-workspace-background-mcp.js";
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from "./report-caller-header.js";
import { DELEGATION_MODE_HEADER } from "./delegation-mode-header.js";
import {
  DELEGATION_ORIGIN_HEADER,
  parseDelegationOriginHeader,
} from "./delegation-origin-header.js";
import type { HonoAppRequestFn } from "../factory.js";

const target = {
  db: {} as Database,
  userId: "user-1",
  workspaceId: "ws-1",
  surfaceKind: "schedule" as const,
};

// Any SPAWNED-session composition now resolves the acting preference from the
// database (Settings → Desktop control, per turn), so those tests cannot hand
// the composer a stub `db`. This gives them a REAL one — the house rule
// anyway. `seed` presets the desktop toggle; `undefined` = never touched.
async function withDesktopTarget(
  seed: boolean | undefined,
  run: (input: typeof target & { db: Database }) => void | Promise<void>,
): Promise<void> {
  await withTestDatabase(async (db) => {
    const now = new Date();
    insertUser(db, {
      id: target.userId,
      displayName: "Dana",
      emailAddress: null,
      locale: "en-US",
      timezone: "UTC",
      hasCompletedOnboarding: true,
      createdAt: now,
      updatedAt: now,
    });
    if (seed !== undefined) {
      upsertPreferenceForUser(
        db,
        target.userId,
        "desktopActionsEnabled",
        JSON.stringify(seed),
      );
    }
    await run({ ...target, db });
  });
}

// A spy dispatcher: records the caller header of every request the composed
// descriptors dispatch (the wrap happens per compose call — per JOB).
function makeSpyAppRequest() {
  const callerHeaders: Array<string | null> = [];
  const appRequest: HonoAppRequestFn = (async (
    _input: unknown,
    init?: RequestInit,
  ) => {
    callerHeaders.push(new Headers(init?.headers).get(REPORT_CALLER_HEADER));
    return new Response("{}", { status: 200 });
  }) as HonoAppRequestFn;
  return { appRequest, callerHeaders };
}

// The dispatcher a composed server's tools would use — captured by the mocked
// descriptor's build (see the vi.mock above).
function dispatcherOf(server: unknown): HonoAppRequestFn {
  return (server as { appRequest: HonoAppRequestFn }).appRequest;
}

describe("buildDelegatedTurnMcpComposer", () => {
  // SPEC CHANGE (2026-07-26, Chad): a spawned session now inherits its PARENT's
  // toolset, so BOTH delegated targets get the interactive descriptor. This
  // reverses the earlier "the leaf, not a router" pin that kept spawning tools
  // away from spawned sessions.
  it("routes both delegated targets to the INTERACTIVE descriptor (a spawned session inherits its parent)", async () => {
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(appRequest);

    // test: correct expectation — vynel-session (whoami) joined every
    // background producer (continuity arc Slice 3, 2026-08-18).
    const workspaceRoot = compose({ ...target, target: "workspace-root" });
    expect(Object.keys(workspaceRoot.mcpServers)).toEqual([
      "vynel-interactive",
      "vynel-notebook",
      "vynel-session",
    ]);
    // whoami answers as the WORKSPACE's own primary on a workspace-root run.
    expect(workspaceRoot.mcpServers["vynel-session"]).toMatchObject({
      sessionId: "ws-primary-1",
    });

    await withDesktopTarget(undefined, (t) => {
      const spawned = compose({
        ...t,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      expect(Object.keys(spawned.mcpServers)).toEqual([
        "vynel-interactive",
        "vynel-notebook",
        "vynel-session",
      ]);
      // …and as the SPAWNED primary the job names on a spawned run.
      expect(spawned.mcpServers["vynel-session"]).toMatchObject({ sessionId: "sp-1" });
    });
  });

  it("stamps the caller-identity header per target (session-comms): workspace-root = the workspace primary, spawned-session = the SESSION", async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(appRequest);

    const workspaceRoot = compose({ ...target, target: "workspace-root" });
    await dispatcherOf(workspaceRoot.mcpServers["vynel-interactive"])(
      "/routing/message",
      {
        method: "POST",
      },
    );
    expect(parseReportCallerHeader(callerHeaders[0] ?? undefined)).toEqual({
      kind: "workspace-primary",
      workspaceId: "ws-1",
    });

    await withDesktopTarget(undefined, async (t) => {
      const spawned = compose({
        ...t,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      await dispatcherOf(spawned.mcpServers["vynel-interactive"])(
        "/routing/message",
        { method: "POST" },
      );
      expect(parseReportCallerHeader(callerHeaders[1] ?? undefined)).toEqual({
        kind: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
    });
  });

  it("a spawned target WITHOUT a primary id gets NO caller header (fail-safe: 400 over mis-addressing as the workspace)", async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(appRequest);
    await withDesktopTarget(undefined, async (t) => {
      const spawned = compose({ ...t, target: "spawned-session" });
      await dispatcherOf(spawned.mcpServers["vynel-interactive"])(
        "/routing/message",
        { method: "POST" },
      );
      expect(callerHeaders[0]).toBeNull();
    });
  });

  it("re-stamps the JOB's permission mode on the routed turn's own requests — the chain inherits end-to-end (auto root → child → grandchild)", async () => {
    const modeHeaders: Array<string | null> = [];
    const appRequest: HonoAppRequestFn = (async (
      _input: unknown,
      init?: RequestInit,
    ) => {
      modeHeaders.push(new Headers(init?.headers).get(DELEGATION_MODE_HEADER));
      return new Response("{}", { status: 200 });
    }) as HonoAppRequestFn;
    const compose = await buildDelegatedTurnMcpComposer(appRequest);

    // A job stamped 'auto' at enqueue: this turn's own delegations carry it on.
    const moded = compose({
      ...target,
      target: "workspace-root",
      permissionMode: "auto",
    });
    await dispatcherOf(moded.mcpServers["vynel-interactive"])(
      "/routing/message",
      { method: "POST" },
    );
    expect(modeHeaders[0]).toBe("auto");

    // A modeless job (channel origin / pre-mode row) stamps NOTHING — its
    // descendants keep the conservative unattended default.
    const modeless = compose({ ...target, target: "workspace-root" });
    await dispatcherOf(modeless.mcpServers["vynel-interactive"])(
      "/routing/message",
      { method: "POST" },
    );
    expect(modeHeaders[1]).toBeNull();
  });

  it("stamps the ORIGIN header when the turn answers a channel — the reply tool's ambient address (channel report protocol)", async () => {
    const originHeaders: Array<string | null> = [];
    const appRequest: HonoAppRequestFn = (async (
      _input: unknown,
      init?: RequestInit,
    ) => {
      originHeaders.push(new Headers(init?.headers).get(DELEGATION_ORIGIN_HEADER));
      return new Response("{}", { status: 200 });
    }) as HonoAppRequestFn;
    const compose = await buildDelegatedTurnMcpComposer(appRequest);

    // A workspace requester's notify turn for channel-driven work: its
    // `reply_to_channel` must reach the exact chat that asked, and the address
    // is server-stamped — a mis-addressed reply is unrecoverable once enqueued.
    const answering = compose({
      ...target,
      target: "workspace-root",
      origin: {
        channelId: "chan-1",
        externalSenderId: "tg-42",
        externalChatContextId: "chat-7",
      },
    });
    await dispatcherOf(answering.mcpServers["vynel-interactive"])(
      "/routing/reply-to-channel",
      { method: "POST" },
    );
    expect(originHeaders[0]).not.toBeNull();
    expect(parseDelegationOriginHeader(originHeaders[0] ?? undefined)).toEqual({
      channelId: "chan-1",
      externalSenderId: "tg-42",
      externalChatContextId: "chat-7",
    });

    // No channel drove the work → nothing stamped, and the tool 400s honestly.
    const plain = compose({ ...target, target: "workspace-root" });
    await dispatcherOf(plain.mcpServers["vynel-interactive"])(
      "/routing/reply-to-channel",
      { method: "POST" },
    );
    expect(originHeaders[1]).toBeNull();
  });
});

// Desktop autopilot (Kafi, 2026-08-11): a task handed to a SPAWNED session is
// the only way desktop work runs while the user does something else — a
// global-root turn holds the per-user root lock for its whole life. These pin
// both halves: that the spawned target GETS the feature, and that the targets
// deliberately left out do NOT.
describe("buildDelegatedTurnMcpComposer — desktop attachment", () => {
  const desktopWired = { desktopReader: { listSince: () => [] } };

  it("attaches desktop to a SPAWNED session (the autopilot unlock)", async () => {
    await withDesktopTarget(true, async (t) => {
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(
        appRequest,
        desktopWired,
      );
      const spawned = compose({
        ...t,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      expect(Object.keys(spawned.mcpServers)).toContain("desktop");
    });
  });

  it("attaches desktop to a GLOBAL-grounded spawned session too — the desktop is the machine, not a workspace", async () => {
    await withDesktopTarget(true, async (t) => {
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(
        appRequest,
        desktopWired,
      );
      const spawned = compose({
        ...t,
        workspaceId: null,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      // test: correct expectation — vynel-session joined (continuity arc Slice 3).
      expect(Object.keys(spawned.mcpServers)).toEqual([
        "vynel-routing",
        "vynel-notebook",
        "vynel-session",
        "desktop",
      ]);
    });
  });

  it("does NOT attach desktop to a workspace-root or agent-session target (scope: spawned only, for now)", async () => {
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(
      appRequest,
      desktopWired,
    );
    expect(
      Object.keys(compose({ ...target, target: "workspace-root" }).mcpServers),
    ).not.toContain("desktop");
    expect(
      Object.keys(
        compose({
          ...target,
          target: "agent-session",
          targetPrimarySessionId: "ag-1",
        }).mcpServers,
      ),
    ).not.toContain("desktop");
  });

  it("attaches nothing when no reader was wired (off-Windows / tests) — the descriptor self-excludes", async () => {
    await withDesktopTarget(true, async (t) => {
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(appRequest);
      const spawned = compose({
        ...t,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      expect(Object.keys(spawned.mcpServers)).not.toContain("desktop");
    });
  });

  // Plan authority follows THIS TURN'S mode, through the same one-home policy
  // the global-root sites use — so the envelope and the approval floor can
  // never disagree about what the turn may do.
  //
  // Kafi settled the fork (2026-08-11): in auto/bypass, NO CARD AT ALL. Those
  // modes are the standing consent, and it carries into work delegated during
  // the turn. The alternative this replaced was worse, not safer: with a
  // display-only envelope the turn still acted card-free (the floor stands down
  // in auto/bypass) but had to mint PERMANENT grant rows to do it.
  const consentOf = (composed: { mcpServers: Record<string, unknown> }) =>
    (composed.mcpServers["desktop"] as { planConsent?: string }).planConsent;

  it.each([
    { mode: "auto", consent: "standing-consent" },
    { mode: "bypass", consent: "standing-consent" },
    { mode: "ask", consent: "approval-card" },
  ])(
    "a $mode turn gets $consent — the plan authorizes for the turn, no permanent grant",
    async ({ mode, consent }) => {
      await withDesktopTarget(true, async (t) => {
        const { appRequest } = makeSpyAppRequest();
        const compose = await buildDelegatedTurnMcpComposer(
          appRequest,
          desktopWired,
        );
        const spawned = compose({
          ...t,
          target: "spawned-session",
          targetPrimarySessionId: "sp-1",
          permissionMode: mode,
        });
        expect(consentOf(spawned)).toBe(consent);
      });
    },
  );

  // The floor that survives the settlement. A channel-origin or pre-mode job
  // carries NO mode; the runner defaults it to `bypass-with-behavior-gate`,
  // where the approval floor holds. There the plan narrates but grants nothing,
  // so "a background turn can never self-grant" stays true exactly where it was
  // meant to.
  it.each([
    {
      label: "no mode at all (channel origin / pre-mode job)",
      mode: undefined,
    },
    {
      label: "the unattended behaviour-gated default",
      mode: "bypass-with-behavior-gate",
    },
  ])(
    "$label falls to display-only — narrates, authorizes nothing",
    async ({ mode }) => {
      await withDesktopTarget(true, async (t) => {
        const { appRequest } = makeSpyAppRequest();
        const compose = await buildDelegatedTurnMcpComposer(
          appRequest,
          desktopWired,
        );
        const spawned = compose({
          ...t,
          target: "spawned-session",
          targetPrimarySessionId: "sp-1",
          ...(mode !== undefined ? { permissionMode: mode } : {}),
        });
        expect(consentOf(spawned)).toBe("display-only");
      });
    },
  );

  it("threads the spawned primary id as the desktop sessionId — the action record keys tasks by it", async () => {
    // Item 6 phase 2: without this, every `desktop_actions` row a delegated
    // turn writes has sessionId NULL and "how far did that task get" reads [].
    await withDesktopTarget(true, async (t) => {
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(
        appRequest,
        desktopWired,
      );
      const spawned = compose({
        ...t,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
      });
      expect(
        (spawned.mcpServers["desktop"] as { sessionId?: string }).sessionId,
      ).toBe("sp-1");
    });
  });

  // THE seam this arc moves: acting is decided by the user's preference at the
  // moment the turn composes — not by a value frozen at boot. A turn composed
  // after the toggle flips sees the new answer with no restart.
  const actingOf = (composed: { mcpServers: Record<string, unknown> }) =>
    (composed.mcpServers["desktop"] as { actionsEnabled?: boolean })
      .actionsEnabled;

  const spawnedWith = async (t: typeof target & { db: Database }) => {
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(
      appRequest,
      desktopWired,
    );
    return compose({
      ...t,
      target: "spawned-session",
      targetPrimarySessionId: "sp-1",
    });
  };

  it("composes the acting tools when the preference is ON", async () => {
    await withDesktopTarget(true, async (t) => {
      expect(actingOf(await spawnedWith(t))).toBe(true);
    });
  });

  it("withholds them when the preference is OFF", async () => {
    await withDesktopTarget(false, async (t) => {
      expect(actingOf(await spawnedWith(t))).toBe(false);
    });
  });

  it("withholds them when the user has never touched the toggle (fail-closed default)", async () => {
    await withDesktopTarget(undefined, async (t) => {
      expect(actingOf(await spawnedWith(t))).toBe(false);
    });
  });

  it("a turn composed AFTER the toggle flips sees the new answer — no restart", async () => {
    await withDesktopTarget(false, async (t) => {
      expect(actingOf(await spawnedWith(t))).toBe(false);
      upsertPreferenceForUser(
        t.db,
        t.userId,
        "desktopActionsEnabled",
        JSON.stringify(true),
      );
      expect(actingOf(await spawnedWith(t))).toBe(true);
    });
  });
});

