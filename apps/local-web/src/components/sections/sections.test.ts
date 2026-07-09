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

  it("shows a workspace room only its own + global channels, with scope chips", async () => {
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
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Global");
    expect(wrapper.text()).toContain("vynel");
    expect(wrapper.text()).not.toContain("Other");
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
