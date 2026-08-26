import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChannelResponse } from "@vynel/contracts/channels/channel-http";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import GlobalWelcomeHero from "./GlobalWelcomeHero.vue";

function makeChannel(
  overrides: Partial<ChannelResponse> = {},
): ChannelResponse {
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

function makeWorkspace(
  overrides: Partial<WorkspaceResponse> = {},
): WorkspaceResponse {
  return {
    id: "w1",
    userId: "u1",
    name: "vynel",
    managerName: "Noah",
    kind: "project",
    path: "E:/spaces/vynel",
    isArchived: false,
    continueEnabled: true,
    groupId: null,
    status: null,
    statusNote: null,
    statusSetAt: null,
    setupCompletedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    lastAccessedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

const baseProps = {
  assistantName: "Claude",
  userFirstName: null,
  channels: [] as ChannelResponse[],
  workspaces: [] as WorkspaceResponse[],
};

describe("GlobalWelcomeHero", () => {
  it("greets the user by first name when known", () => {
    const wrapper = mount(GlobalWelcomeHero, {
      props: { ...baseProps, userFirstName: "Sam" },
    });

    expect(wrapper.find(".hero-greeting").text()).toMatch(
      /^(Good (morning|afternoon|evening)|Up late), Sam\.$/,
    );
  });

  it("greets without a name while the profile is unknown", () => {
    const wrapper = mount(GlobalWelcomeHero, { props: baseProps });

    expect(wrapper.find(".hero-greeting").text()).toMatch(
      /^(Good (morning|afternoon|evening)|Up late)\.$/,
    );
  });

  it("wears the assistant name as the wordmark and wake phrase", () => {
    const wrapper = mount(GlobalWelcomeHero, { props: baseProps });

    expect(wrapper.find(".hero-wordmark").text()).toBe("Claude");
    expect(wrapper.text()).toContain("“Hey Claude”");
    expect(wrapper.text()).toContain("Voice");
  });

  it("shows enabled channels with a connection note, hiding disabled ones", () => {
    const wrapper = mount(GlobalWelcomeHero, {
      props: {
        ...baseProps,
        channels: [
          makeChannel({ displayName: "Family bot" }),
          makeChannel({ id: "off", displayName: "Old bot", isEnabled: false }),
        ],
      },
    });

    expect(wrapper.text()).toContain("Family bot");
    expect(wrapper.text()).toContain("Connected");
    expect(wrapper.text()).not.toContain("Old bot");
  });

  it("renders workspace cards with the manager persona and emits on click", async () => {
    const wrapper = mount(GlobalWelcomeHero, {
      props: { ...baseProps, workspaces: [makeWorkspace()] },
    });

    const card = wrapper.find(".deck-card.is-workspace");
    expect(card.text()).toContain("vynel");
    expect(card.text()).toContain("With Noah");
    expect(card.attributes("style")).toContain("--accent");

    await card.trigger("click");
    expect(wrapper.emitted("openWorkspace")).toEqual([["w1"]]);
  });

  it("falls back to the workspace kind when there is no manager persona", () => {
    const wrapper = mount(GlobalWelcomeHero, {
      props: {
        ...baseProps,
        workspaces: [makeWorkspace({ managerName: null, kind: "personal" })],
      },
    });

    expect(wrapper.text()).toContain("Personal");
  });

  it("invites creating a workspace when none exist", () => {
    const wrapper = mount(GlobalWelcomeHero, { props: baseProps });

    expect(wrapper.text()).toContain("No workspaces yet");
    expect(wrapper.text()).toContain("Ask Claude to set one up.");
  });
});
