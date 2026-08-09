import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import DesktopAccessSection from "./DesktopAccessSection.vue";

function makeGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant1",
    appName: "discord",
    tier: "click",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function mountSection(client: VynelClient) {
  return mount(DesktopAccessSection, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ] as [typeof VueQueryPlugin, unknown],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
}

describe("DesktopAccessSection", () => {
  it("lists grants with the tier in words, and revoking is a two-step", async () => {
    const revoked: string[] = [];
    const client = {
      desktopAccess: {
        list: async () => [makeGrant(), makeGrant({ id: "grant2", appName: "notepad", tier: "read" })],
        revoke: async (appName: string) => {
          revoked.push(appName);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.text()).toContain("discord");
    expect(wrapper.text()).toContain("Look + click");
    expect(wrapper.text()).toContain("notepad");
    expect(wrapper.text()).toContain("Look only");

    // First click arms; nothing is revoked yet.
    const revokeButton = wrapper.findAll("button.revoke-button")[0]!;
    await revokeButton.trigger("click");
    expect(revoked).toEqual([]);
    expect(revokeButton.text()).toContain("Really revoke?");

    // Second click revokes the armed app.
    await revokeButton.trigger("click");
    await flushPromises();
    expect(revoked).toEqual(["discord"]);
  });

  it("shows the consent-card explainer when nothing is granted (no add button by design)", async () => {
    const client = {
      desktopAccess: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.text()).toContain("No apps granted yet");
    // test: correct expectation — the copy now states the MODE MATRIX honestly
    // (ask = card; auto/bypass = the mode is the consent), replacing the
    // inaccurate "asks first, always" wording. Chad 2026-08-04.
    expect(wrapper.text()).toContain("Ask mode");
    expect(wrapper.text()).toContain("Bypass");
    expect(wrapper.find("button.add-button").exists()).toBe(false);
  });
});
