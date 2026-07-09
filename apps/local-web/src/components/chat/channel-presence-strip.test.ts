import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChannelResponse } from "@vynel/contracts/channels/channel-http";
import ChannelPresenceStrip from "./ChannelPresenceStrip.vue";

function makeChannel(overrides: Partial<ChannelResponse> = {}): ChannelResponse {
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

describe("ChannelPresenceStrip", () => {
  it("always shows the Voice channel, even with no configured channels", () => {
    const wrapper = mount(ChannelPresenceStrip, { props: { channels: [] } });
    expect(wrapper.text()).toContain("Voice");
  });

  it("renders enabled channels and marks a healthy one ok", () => {
    const wrapper = mount(ChannelPresenceStrip, {
      props: { channels: [makeChannel({ displayName: "Family bot" })] },
    });

    expect(wrapper.text()).toContain("Family bot");
    expect(wrapper.find(".status-dot.is-ok").exists()).toBe(true);
  });

  it("hides disabled channels but flags an unhealthy enabled one", () => {
    const wrapper = mount(ChannelPresenceStrip, {
      props: {
        channels: [
          makeChannel({ id: "off", displayName: "Old bot", isEnabled: false }),
          makeChannel({
            id: "warn",
            displayName: "Broken bot",
            connectionStatus: "auth-failed",
          }),
        ],
      },
    });

    expect(wrapper.text()).not.toContain("Old bot");
    expect(wrapper.text()).toContain("Broken bot");
    expect(wrapper.find(".status-dot.is-warn").exists()).toBe(true);
  });
});
