import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { SdkError, type VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import AccountSection from "./AccountSection.vue";

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    deviceName: "KLONE desktop",
    devicePlatform: "windows",
    appVersion: "0.4.0",
    lastUsedAt: "2026-07-10T08:00:00.000Z",
    expiresAt: "2026-08-10T08:00:00.000Z",
    ...overrides,
  };
}

function mountAccount(client: VynelClient) {
  return mount(AccountSection, {
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

describe("AccountSection", () => {
  it("explains the missing hub quietly when not configured", async () => {
    const client = {
      hub: { getSession: async () => ({ kind: "not-configured" }) },
    } as unknown as VynelClient;

    const wrapper = mountAccount(client);
    await flushPromises();

    expect(wrapper.text()).toContain("VYNEL_HUB_URL");
    expect(wrapper.find(".sign-in-card").exists()).toBe(false);
  });

  it("signs in from the form and surfaces the API's message on 401", async () => {
    const signInCalls: unknown[] = [];
    const client = {
      hub: {
        getSession: async () => ({ kind: "signed-out" }),
        signIn: async (input: unknown) => {
          signInCalls.push(input);
          throw new SdkError(new Response(null, { status: 401 }), {
            code: "hub-unauthorized",
            message: "Wrong email or password.",
          });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountAccount(client);
    await flushPromises();

    await wrapper.find('input[type="email"]').setValue("chad@vynel.app");
    await wrapper.find('input[type="password"]').setValue("hunter2");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(signInCalls).toEqual([
      { email: "chad@vynel.app", password: "hunter2" },
    ]);
    expect(wrapper.text()).toContain("Wrong email or password.");
  });

  it("shows the identity card and the account's devices when signed in", async () => {
    const client = {
      hub: {
        getSession: async () => ({
          kind: "signed-in",
          email: "chad@vynel.app",
          displayName: "Chad",
          checkedAt: "2026-07-10T09:00:00.000Z",
          tier: "pro",
          features: ["channels", "schedules", "knowledge", "memory"],
        }),
        listDevices: async () => ({
          devices: [
            makeDevice(),
            makeDevice({
              id: "d2",
              deviceName: "MacBook",
              devicePlatform: "macos",
            }),
          ],
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mountAccount(client);
    await flushPromises();

    expect(wrapper.text()).toContain("Chad");
    expect(wrapper.text()).toContain("chad@vynel.app");
    expect(wrapper.find(".tier-chip").text()).toBe("Pro");
    expect(wrapper.text()).toContain("KLONE desktop");
    expect(wrapper.text()).toContain("MacBook");
    expect(wrapper.find(".add-button").text()).toContain("Sign out");
  });

  it("shows the plan chip on the offline card only while the grace window holds", async () => {
    const inGrace = {
      hub: {
        getSession: async () => ({
          kind: "offline",
          email: "chad@vynel.app",
          displayName: "Chad",
          tier: "basic",
          features: ["channels"],
        }),
      },
    } as unknown as VynelClient;

    const graceWrapper = mountAccount(inGrace);
    await flushPromises();

    expect(graceWrapper.text()).toContain("Can't reach the hub");
    expect(graceWrapper.find(".tier-chip").text()).toBe("Basic");

    const pastGrace = {
      hub: {
        getSession: async () => ({
          kind: "offline",
          email: null,
          displayName: null,
          tier: null,
          features: [],
        }),
      },
    } as unknown as VynelClient;

    const expiredWrapper = mountAccount(pastGrace);
    await flushPromises();

    expect(expiredWrapper.find(".tier-chip").exists()).toBe(false);
  });

  it("revokes a device only after the explicit confirm click", async () => {
    const revokedIds: string[] = [];
    const client = {
      hub: {
        getSession: async () => ({
          kind: "signed-in",
          email: "chad@vynel.app",
          displayName: "Chad",
          checkedAt: "2026-07-10T09:00:00.000Z",
          tier: "basic",
          features: ["channels"],
        }),
        listDevices: async () => ({ devices: [makeDevice()] }),
        revokeDevice: async (deviceId: string) => {
          revokedIds.push(deviceId);
          return { revoked: true };
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountAccount(client);
    await flushPromises();

    await wrapper.find(".row-action").trigger("click");
    expect(revokedIds).toEqual([]);

    await wrapper.find(".row-action.is-danger").trigger("click");
    await flushPromises();
    expect(revokedIds).toEqual(["d1"]);
  });
});
