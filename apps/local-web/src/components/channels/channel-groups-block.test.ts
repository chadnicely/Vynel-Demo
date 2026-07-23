import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import ChannelGroupsBlock from "./ChannelGroupsBlock.vue";

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    channelId: "c1",
    externalChatContextId: "-100777",
    title: "Marketing Team",
    status: "pending",
    memberPolicy: "everyone",
    firstSeenAt: "2026-07-23T10:00:00.000Z",
    lastInboundAt: null,
    approvedAt: null,
    ...overrides,
  };
}

function makeHarness(groups: unknown[] = [makeGroup()]) {
  const calls: Record<string, unknown[]> = {
    approveGroup: [],
    ignoreGroup: [],
    setGroupPolicy: [],
  };
  const client = {
    channelsUser: {
      listGroups: async () => groups,
      approveGroup: async (channelId: string, groupId: string) => {
        calls.approveGroup!.push([channelId, groupId]);
        return makeGroup({ status: "approved" });
      },
      ignoreGroup: async (channelId: string, groupId: string) => {
        calls.ignoreGroup!.push([channelId, groupId]);
        return makeGroup({ status: "ignored" });
      },
      setGroupPolicy: async (channelId: string, groupId: string, input: unknown) => {
        calls.setGroupPolicy!.push([channelId, groupId, input]);
        return makeGroup({ status: "approved", memberPolicy: "allowlist" });
      },
    },
  } as unknown as VynelClient;

  const wrapper = mount(ChannelGroupsBlock, {
    props: { channelId: "c1" },
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
  return { wrapper, calls };
}

describe("ChannelGroupsBlock", () => {
  it("teaches the discovery ritual when no groups exist", async () => {
    const { wrapper } = makeHarness([]);
    await flushPromises();
    expect(wrapper.text()).toContain("@mention it once");
  });

  it("a pending group shows Approve + Ignore; approving calls the route", async () => {
    const { wrapper, calls } = makeHarness();
    await flushPromises();

    expect(wrapper.text()).toContain("Marketing Team");
    expect(wrapper.text()).toContain("Wants in");

    await wrapper.get('[aria-label="Approve Marketing Team"]').trigger("click");
    await flushPromises();
    expect(calls.approveGroup).toEqual([["c1", "g1"]]);
  });

  it("an approved group carries the member-policy select; changing it calls the route", async () => {
    const { wrapper, calls } = makeHarness([makeGroup({ status: "approved" })]);
    await flushPromises();

    const select = wrapper.get<HTMLSelectElement>(
      '[aria-label="Who can talk in Marketing Team"]',
    );
    select.element.value = "allowlist";
    await select.trigger("change");
    await flushPromises();

    expect(calls.setGroupPolicy).toEqual([
      ["c1", "g1", { memberPolicy: "allowlist" }],
    ]);
    // An approved group offers Ignore (revoke) but not Approve.
    expect(
      wrapper.find('[aria-label="Approve Marketing Team"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[aria-label="Ignore Marketing Team"]').exists(),
    ).toBe(true);
  });

  it("an ignored group can be re-approved and falls back to the context id without a title", async () => {
    const { wrapper, calls } = makeHarness([
      makeGroup({ status: "ignored", title: null }),
    ]);
    await flushPromises();

    expect(wrapper.text()).toContain("-100777");
    await wrapper.get('[aria-label="Approve -100777"]').trigger("click");
    await flushPromises();
    expect(calls.ignoreGroup).toEqual([]);
    expect(calls.approveGroup).toEqual([["c1", "g1"]]);
  });
});
