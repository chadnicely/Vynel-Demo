import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import ChannelsSection from "./ChannelsSection.vue";
import SchedulesSection from "./SchedulesSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    userId: "u1",
    workspaceId: null,
    channelKind: "telegram",
    displayName: "My Telegram",
    botMetadata: {},
    connectionStatus: "healthy",
    connectionStatusMessage: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    userId: "u1",
    workspaceId: null,
    templateKind: "custom",
    scheduleKind: "recurring",
    displayName: "Morning digest",
    cronExpression: "0 9 * * *",
    timezone: "UTC",
    promptTemplate: "Summarize the morning",
    destinationKind: "chat-only",
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: "2026-07-10T09:00:00.000Z",
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function mountSection(
  component: typeof ChannelsSection | typeof SchedulesSection,
  scope: SectionScope,
  client: VynelClient,
) {
  return mount(component, {
    props: { scope },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
}

describe("ChannelsSection", () => {
  it("invites connecting when there are no channels", async () => {
    const client = {
      channelsUser: { list: async () => [] },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(ChannelsSection, { kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("No channels yet");
    expect(wrapper.find(".invite-button").text()).toContain("Connect Telegram");
  });

  // test: correct expectation for scope visibility — was "workspace = own +
  // global", now STRICT per Chad's 2026-07-23 rule: each scope lists only its
  // own channels (docs/module-notes/channels-ui.md).
  it("a workspace room lists ONLY its own channels — never global or another room's", async () => {
    const client = {
      channelsUser: {
        list: async () => [
          makeChannel(),
          makeChannel({ id: "c2", workspaceId: "w1", displayName: "Room bot" }),
          makeChannel({ id: "c3", workspaceId: "OTHER", displayName: "Other" }),
        ],
      },
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(
      ChannelsSection,
      { kind: "workspace", workspaceId: "w1" },
      client,
    );
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(1);
    expect(wrapper.text()).toContain("Room bot");
    expect(wrapper.text()).not.toContain("My Telegram");
    expect(wrapper.text()).not.toContain("Other");
  });

  it("the global menu lists ONLY global (null-workspace) channels", async () => {
    const client = {
      channelsUser: {
        list: async () => [
          makeChannel(),
          makeChannel({ id: "c2", workspaceId: "w1", displayName: "Room bot" }),
        ],
      },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(ChannelsSection, { kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("My Telegram");
    expect(wrapper.text()).not.toContain("Room bot");
  });

  it("disconnects only on the second, armed click (one click never deletes)", async () => {
    const disconnectCalls: unknown[] = [];
    const client = {
      channelsUser: {
        list: async () => [makeChannel()],
        disconnect: async (channelId: string) => {
          disconnectCalls.push(channelId);
        },
      },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(ChannelsSection, { kind: "global" }, client);
    await flushPromises();

    // First click only arms — the control flips to "Sure?" and nothing fires.
    const armButton = wrapper.get('[aria-label="Disconnect My Telegram"]');
    await armButton.trigger("click");
    await flushPromises();
    expect(disconnectCalls).toEqual([]);

    const confirmButton = wrapper.get(
      '[aria-label="Confirm disconnect My Telegram"]',
    );
    expect(confirmButton.text()).toBe("Sure?");
    await confirmButton.trigger("click");
    await flushPromises();
    expect(disconnectCalls).toEqual(["c1"]);
  });

  it("disarms the disconnect confirm on blur instead of firing", async () => {
    const disconnectCalls: unknown[] = [];
    const client = {
      channelsUser: {
        list: async () => [makeChannel()],
        disconnect: async (channelId: string) => {
          disconnectCalls.push(channelId);
        },
      },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(ChannelsSection, { kind: "global" }, client);
    await flushPromises();

    await wrapper.get('[aria-label="Disconnect My Telegram"]').trigger("click");
    await wrapper
      .get('[aria-label="Confirm disconnect My Telegram"]')
      .trigger("blur");
    await flushPromises();

    expect(disconnectCalls).toEqual([]);
    expect(
      wrapper.find('[aria-label="Disconnect My Telegram"]').exists(),
    ).toBe(true);
  });
});

describe("SchedulesSection", () => {
  it("reads a schedule row as words and toggles it in place", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      schedulesUser: {
        list: async () => [makeSchedule()],
        update: async (scheduleId: string, input: unknown) => {
          updateCalls.push([scheduleId, input]);
          return makeSchedule({ isEnabled: false });
        },
      },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(SchedulesSection, { kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("Morning digest");
    expect(wrapper.text()).toMatch(/Daily at 9:00/);

    await wrapper.find(".pill").trigger("click");
    await flushPromises();
    expect(updateCalls).toEqual([["s1", { isEnabled: false }]]);
  });

  it("the global menu lists ONLY global (null-workspace) schedules", async () => {
    const client = {
      schedulesUser: {
        list: async () => [
          makeSchedule(),
          makeSchedule({
            id: "s2",
            workspaceId: "w1",
            displayName: "Room digest",
          }),
        ],
      },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(SchedulesSection, { kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Morning digest");
    expect(wrapper.text()).not.toContain("Room digest");
  });

  // Strict per Chad's 2026-07-23 scope rule (same as channels): the workspace
  // menu reads the server-filtered workspace route, never the user union.
  it("a workspace room lists ONLY its own schedules — never global ones", async () => {
    const listCalls: string[] = [];
    const client = {
      schedules: {
        list: async (workspaceId: string) => {
          listCalls.push(workspaceId);
          return [
            makeSchedule({
              id: "s2",
              workspaceId: "w1",
              displayName: "Room digest",
            }),
          ];
        },
      },
      workspaces: {
        list: async () => [{ id: "w1", name: "letterman", isArchived: false }],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(
      SchedulesSection,
      { kind: "workspace", workspaceId: "w1" },
      client,
    );
    await flushPromises();

    expect(listCalls).toEqual(["w1"]);
    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Room digest");
    expect(wrapper.text()).not.toContain("Morning digest");
  });

  it("invites scheduling when there is nothing yet", async () => {
    const client = {
      schedulesUser: { list: async () => [] },
      workspaces: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(SchedulesSection, { kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("Nothing scheduled yet");
  });
});
