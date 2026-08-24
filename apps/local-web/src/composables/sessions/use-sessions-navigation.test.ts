// The Sessions surface's navigation home: the scope and the open conversation
// ride the route, a room's own row routes to the room, a superseded part opens
// view-only by `part`, and the back row returns to the scope's menus.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { createAppRouter } from "../../router.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useSessionsNavigation } from "./use-sessions-navigation.js";

function makeEntry(
  overrides: Partial<SessionsOverviewEntry> = {},
): SessionsOverviewEntry {
  return {
    sessionId: "sp-1",
    primarySessionId: null,
    scope: "spawned",
    workspaceId: null,
    workspaceName: null,
    title: "Research: pricing",
    icon: null,
    model: null,
    contextTokens: null,
    contextWindow: 200_000,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    statusFacts: {
      setStatus: null,
      statusNote: null,
      statusSetAt: null,
      lastError: null,
      pendingApprovalCount: 0,
      pendingAskCount: 0,
      latestUserMessageAt: null,
    },
    segments: [],
    ...overrides,
  };
}

async function mountAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const pinia = createPinia();
  let navigation!: ReturnType<typeof useSessionsNavigation>;
  const Host = defineComponent({
    setup() {
      navigation = useSessionsNavigation();
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [router, pinia] } });
  return { navigation, router, pinia };
}

async function settle(router: ReturnType<typeof createAppRouter>) {
  // The target routes lazy-load their view chunks — settle the import first.
  await vi.dynamicImportSettled();
  await flushPromises();
  return router.currentRoute.value;
}

describe("useSessionsNavigation", () => {
  it("reads the scope, the open conversation and the part off the route", async () => {
    const { navigation } = await mountAt(
      "/sessions?workspace=w1&session=sp-2&part=sp-1",
    );
    expect(navigation.workspaceScopeId.value).toBe("w1");
    expect(navigation.openSessionId.value).toBe("sp-2");
    expect(navigation.openPartId.value).toBe("sp-1");
  });

  it("bare /sessions is the global library with nothing open", async () => {
    const { navigation } = await mountAt("/sessions");
    expect(navigation.workspaceScopeId.value).toBeNull();
    expect(navigation.openSessionId.value).toBeNull();
    expect(navigation.openPartId.value).toBeNull();
  });

  it("opening a spawned session names it on the route, keeping the scope", async () => {
    const { navigation, router } = await mountAt("/sessions?workspace=w1");
    navigation.openEntry(makeEntry({ workspaceId: "w1" }));
    const route = await settle(router);
    expect(route.name).toBe("sessions");
    expect(route.query).toEqual({ workspace: "w1", session: "sp-1" });
  });

  it("a room's own conversation routes to the room — it lives in its Chat", async () => {
    const { navigation, router, pinia } = await mountAt("/sessions?workspace=w1");
    navigation.openEntry(
      makeEntry({ sessionId: "ws-1", scope: "workspace", workspaceId: "w1" }),
    );
    const route = await settle(router);
    expect(route.name).toBe("workspace");
    expect(useUiStore(pinia).activeWorkspaceId).toBe("w1");
  });

  it("the head segment opens the conversation itself; a superseded part opens by `part`", async () => {
    const { navigation, router } = await mountAt("/sessions");
    const entry = makeEntry({ sessionId: "sp-2" });
    const head = { sessionId: "sp-2" } as SessionsOverviewEntry["segments"][number];
    const earlier = { sessionId: "sp-1" } as SessionsOverviewEntry["segments"][number];

    navigation.openSegment(entry, head);
    expect((await settle(router)).query).toEqual({ session: "sp-2" });

    navigation.openSegment(entry, earlier);
    expect((await settle(router)).query).toEqual({ session: "sp-2", part: "sp-1" });
  });

  it("the back row returns to the scope's menus — the room, or the global chat — never the tree", async () => {
    const scoped = await mountAt("/sessions?workspace=w1");
    // A cold load leaves the workspace tree open; the row names the MENUS.
    useUiStore(scoped.pinia).isWorkspaceTreeOpen = true;
    scoped.navigation.leaveSessions();
    expect((await settle(scoped.router)).name).toBe("workspace");
    expect(useUiStore(scoped.pinia).isWorkspaceTreeOpen).toBe(false);

    const global = await mountAt("/sessions");
    global.navigation.leaveSessions();
    expect((await settle(global.router)).name).toBe("chat");
  });
});
