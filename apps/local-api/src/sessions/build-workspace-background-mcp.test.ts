// Pins the delegated-turn composer's DESCRIPTOR ROUTING (the 2026-07-21
// re-decision of the ④b pin): a workspace-root target composes the INTERACTIVE
// vynel descriptor (session-routing trio included), a spawned-session target
// the plain one — and schedule fires' plain composer never touches the
// interactive descriptor at all. The descriptors are mocked with markers
// because a built SDK server is opaque; the real composition output is covered
// by build-schedule-fire-deps.test.ts against the true registry.

import { describe, expect, it, vi } from "vitest";
import type { Database } from "@vynel/db";

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
import type { HonoAppRequestFn } from "../factory.js";

const target = {
  db: {} as Database,
  userId: "user-1",
  workspaceId: "ws-1",
  surfaceKind: "schedule" as const,
};

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

    const spawned = compose({
      ...target,
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

    const spawned = compose({
      ...target,
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

  it("a spawned target WITHOUT a primary id gets NO caller header (fail-safe: 400 over mis-addressing as the workspace)", async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(appRequest);
    const spawned = compose({ ...target, target: "spawned-session" });
    await dispatcherOf(spawned.mcpServers["vynel-interactive"])(
      "/routing/message",
      { method: "POST" },
    );
    expect(callerHeaders[0]).toBeNull();
  });
});

// Desktop autopilot (Kafi, 2026-08-11): a task handed to a SPAWNED session is
// the only way desktop work runs while the user does something else — a
// global-root turn holds the per-user root lock for its whole life. These pin
// both halves: that the spawned target GETS the feature, and that the targets
// deliberately left out do NOT.
describe("buildDelegatedTurnMcpComposer — desktop attachment", () => {
  const desktopWired = {
    desktopReader: { listSince: () => [] },
    enableDesktopActions: true,
  };

  it("attaches desktop to a SPAWNED session (the autopilot unlock)", async () => {
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(
      appRequest,
      desktopWired,
    );
    const spawned = compose({
      ...target,
      target: "spawned-session",
      targetPrimarySessionId: "sp-1",
    });
    expect(Object.keys(spawned.mcpServers)).toContain("desktop");
  });

  it("attaches desktop to a GLOBAL-grounded spawned session too — the desktop is the machine, not a workspace", async () => {
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(
      appRequest,
      desktopWired,
    );
    const spawned = compose({
      ...target,
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
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(appRequest);
    const spawned = compose({
      ...target,
      target: "spawned-session",
      targetPrimarySessionId: "sp-1",
    });
    expect(Object.keys(spawned.mcpServers)).not.toContain("desktop");
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
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(
        appRequest,
        desktopWired,
      );
      const spawned = compose({
        ...target,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
        permissionMode: mode,
      });
      expect(consentOf(spawned)).toBe(consent);
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
      const { appRequest } = makeSpyAppRequest();
      const compose = await buildDelegatedTurnMcpComposer(
        appRequest,
        desktopWired,
      );
      const spawned = compose({
        ...target,
        target: "spawned-session",
        targetPrimarySessionId: "sp-1",
        ...(mode !== undefined ? { permissionMode: mode } : {}),
      });
      expect(consentOf(spawned)).toBe("display-only");
    },
  );

  it("threads the spawned primary id as the desktop sessionId — the action record keys tasks by it", async () => {
    // Item 6 phase 2: without this, every `desktop_actions` row a delegated
    // turn writes has sessionId NULL and "how far did that task get" reads [].
    const { appRequest } = makeSpyAppRequest();
    const compose = await buildDelegatedTurnMcpComposer(
      appRequest,
      desktopWired,
    );
    const spawned = compose({
      ...target,
      target: "spawned-session",
      targetPrimarySessionId: "sp-1",
    });
    expect(
      (spawned.mcpServers["desktop"] as { sessionId?: string }).sessionId,
    ).toBe("sp-1");
  });

  it("carries the boot actions flag through", async () => {
    const { appRequest } = makeSpyAppRequest();
    const off = await buildDelegatedTurnMcpComposer(appRequest, {
      ...desktopWired,
      enableDesktopActions: false,
    });
    const spawned = off({
      ...target,
      target: "spawned-session",
      targetPrimarySessionId: "sp-1",
    });
    expect(
      (spawned.mcpServers["desktop"] as { actionsEnabled?: boolean })
        .actionsEnabled,
    ).toBe(false);
  });
});

describe("buildWorkspaceBackgroundMcpComposer", () => {
  it("composes ONLY the plain descriptor (schedule fires never gain the routing trio) and stamps NO caller header (autonomous turns have no requester)", async () => {
    const { appRequest, callerHeaders } = makeSpyAppRequest();
    const compose = await buildWorkspaceBackgroundMcpComposer(appRequest);
    const composed = compose(target);
    // test: correct expectation — vynel-session joined (continuity arc Slice 3).
    // A schedule fire starts a FRESH session and names no primary: whoami
    // answers as a plain conversation (no identity handed to it).
    expect(Object.keys(composed.mcpServers)).toEqual([
      "vynel-plain",
      "vynel-notebook",
      "vynel-session",
    ]);
    expect(composed.mcpServers["vynel-session"]).toMatchObject({ sessionId: undefined });
    // A workspace-grounded spawned session DM'd directly names its primary.
    expect(
      compose({ ...target, primarySessionId: "sp-dm-1" }).mcpServers["vynel-session"],
    ).toMatchObject({ sessionId: "sp-dm-1" });
    await dispatcherOf(composed.mcpServers["vynel-plain"])("/routing/message", {
      method: "POST",
    });
    expect(callerHeaders[0]).toBeNull();
  });
});
