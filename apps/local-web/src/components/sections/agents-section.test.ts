// The Agents shelf on both surfaces. Guards the behaviors that make an
// installed agent REAL to the user: every source renders (a marketplace
// "community" install is a first-class row — the bug this section fixed),
// provenance + scope chips, the On/Off pill driving `agents.setEnabled`,
// and the surface split: a workspace drawer lists user-scope ∪ that
// workspace's agents, the global menu the user-scope shelf only.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WorkspaceSectionPanel from "../workspace/WorkspaceSectionPanel.vue";
import AgentsSection from "./AgentsSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    slug: "focus-writer",
    name: "Focus Writer",
    description: "A persona for deep-focus writing.",
    icon: null,
    prompt: "You write with focus.",
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: "workspace",
    workspaceId: "w1",
    source: "community",
    trustTier: "community",
    enabled: true,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

function makeClient(options: {
  list?: (...args: unknown[]) => Promise<unknown>;
  listResolved?: (...args: unknown[]) => Promise<unknown>;
  setEnabled?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agents: {
      list: options.list ?? (async () => [makeAgent()]),
      listResolved: options.listResolved ?? (async () => [makeAgent()]),
      setEnabled:
        options.setEnabled ?? (async () => makeAgent({ enabled: false })),
    },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
    // WorkspaceSectionPanel's own composables (tier gate + skills query).
    hub: { getSession: async () => ({ kind: "signed-out" }) },
    skills: { listInstalled: async () => [] },
  };
}

function mountOptions(client: ReturnType<typeof makeClient>) {
  const plugins: [Plugin, ...unknown[]][] = [
    [
      VueQueryPlugin,
      {
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
    ],
  ];
  return {
    global: {
      plugins,
      provide: { [vynelClientKey as symbol]: client },
    },
  };
}

function mountSection(
  client: ReturnType<typeof makeClient>,
  scope: SectionScope = { kind: "workspace", workspaceId: "w1" },
) {
  return mount(AgentsSection, {
    props: { scope },
    ...mountOptions(client),
  });
}

describe("AgentsSection — rows", () => {
  it("renders a community-sourced agent with its provenance and scope chips", async () => {
    const wrapper = mountSection(makeClient());
    await flushPromises();

    expect(wrapper.text()).toContain("Focus Writer");
    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("Community");
    expect(chips).toContain("vynel");
    wrapper.unmount();
  });

  it("marks curated installs but leaves a user-built agent without a source chip", async () => {
    const wrapper = mountSection(
      makeClient({
        list: async () => [
          makeAgent({
            id: "a2",
            slug: "researcher",
            name: "Researcher",
            source: "vynel",
            trustTier: "verified",
            scope: "user",
            workspaceId: null,
          }),
          makeAgent({
            id: "a3",
            slug: "my-own",
            name: "My Own",
            source: "user",
            scope: "user",
            workspaceId: null,
          }),
        ],
      }),
    );
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Curated");
    expect(rows[1]!.text()).not.toContain("Curated");
    expect(rows[1]!.text()).not.toContain("Community");
    wrapper.unmount();
  });

  it("invites a marketplace visit when there are no agents", async () => {
    const wrapper = mountSection(makeClient({ list: async () => [] }));
    await flushPromises();

    expect(wrapper.text()).toContain("No agents yet");
    expect(wrapper.text()).toContain("Marketplace");
    wrapper.unmount();
  });
});

describe("AgentsSection — surfaces", () => {
  // SPEC CHANGE (2026-08-03): the menu asks what the scope OWNS (`agents.list`)
  // so the shelf mirrors disk; the composer's "@" picker asks what a session
  // there can reach (`agents.listResolved`, user ∪ workspace). The section must
  // never reach for the resolved route, or a global agent reappears in a room's
  // shelf with manage controls the room doesn't own.
  it("asks for the workspace's OWN agents, never the resolved union", async () => {
    const list = vi.fn(async () => [makeAgent()]);
    const listResolved = vi.fn(async () => [makeAgent()]);
    const wrapper = mountSection(makeClient({ list, listResolved }));
    await flushPromises();

    expect(list).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(listResolved).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("asks for the user-scope shelf on the global surface (no workspaceId)", async () => {
    const list = vi.fn(async () => [
      makeAgent({ scope: "user", workspaceId: null }),
    ]);
    const wrapper = mountSection(makeClient({ list }), { kind: "global" });
    await flushPromises();

    expect(list).toHaveBeenCalledWith();
    expect(wrapper.text()).toContain("Focus Writer");
    wrapper.unmount();
  });
});

describe("AgentsSection — enable toggle", () => {
  it("flips the agent via agents.setEnabled from the On pill", async () => {
    const setEnabled = vi.fn(async () => makeAgent({ enabled: false }));
    const wrapper = mountSection(makeClient({ setEnabled }));
    await flushPromises();

    const pill = wrapper.get("button.pill");
    expect(pill.text()).toBe("On");
    await pill.trigger("click");
    await flushPromises();

    expect(setEnabled).toHaveBeenCalledWith("a1", { enabled: false });
    wrapper.unmount();
  });

  it("turns a disabled agent back on", async () => {
    const setEnabled = vi.fn(async () => makeAgent());
    const wrapper = mountSection(
      makeClient({
        list: async () => [makeAgent({ enabled: false })],
        setEnabled,
      }),
    );
    await flushPromises();

    const pill = wrapper.get("button.pill");
    expect(pill.text()).toBe("Off");
    await pill.trigger("click");
    await flushPromises();

    expect(setEnabled).toHaveBeenCalledWith("a1", { enabled: true });
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — agents delegation", () => {
  it("hosts AgentsSection for the agents drawer item (no more stub)", async () => {
    const wrapper = mount(WorkspaceSectionPanel, {
      props: { section: "agents" as const, workspaceId: "w1" },
      ...mountOptions(makeClient()),
    });
    await flushPromises();

    expect(wrapper.findComponent(AgentsSection).exists()).toBe(true);
    expect(wrapper.text()).toContain("Focus Writer");
    wrapper.unmount();
  });
});
