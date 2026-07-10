// The tier-gate derivation: a lock exists ONLY while a live entitlement is
// present (signed-in, or offline inside the grace window). No entitlement —
// not-configured, signed-out, offline past grace — gates NOTHING: the app
// must behave exactly as it did before tiers existed.

import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useHubFeatures } from "./use-hub-features.js";

function mountFeatures(status: Record<string, unknown>) {
  let features!: ReturnType<typeof useHubFeatures>;
  const Host = defineComponent({
    setup() {
      features = useHubFeatures();
      return () => h("div");
    },
  });
  const wrapper = mount(Host, {
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
      provide: {
        [vynelClientKey as symbol]: {
          hub: { getSession: async () => status },
        },
      },
    },
  });
  return { wrapper, features: () => features };
}

describe("useHubFeatures", () => {
  it("locks exactly the features a signed-in entitlement lacks", async () => {
    const { wrapper, features } = mountFeatures({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-10T09:00:00.000Z",
      tier: "basic",
      features: ["channels"],
    });

    // Before the status lands nothing is locked — a race must not flash locks.
    expect(features().hasEntitlement.value).toBe(false);
    expect(features().isLocked("schedules")).toBe(false);

    await flushPromises();

    expect(features().hasEntitlement.value).toBe(true);
    expect(features().isPro.value).toBe(false);
    expect(features().isLocked("channels")).toBe(false);
    expect(features().isLocked("schedules")).toBe(true);
    expect(features().isLocked("knowledge")).toBe(true);
    expect(features().isLocked("memory")).toBe(true);
    expect(features().isLocked("marketplace")).toBe(true);
    wrapper.unmount();
  });

  it("locks nothing on pro (every feature present)", async () => {
    const { wrapper, features } = mountFeatures({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-10T09:00:00.000Z",
      tier: "pro",
      features: [
        "channels",
        "voice",
        "schedules",
        "knowledge",
        "memory",
        "marketplace",
      ],
    });
    await flushPromises();

    expect(features().hasEntitlement.value).toBe(true);
    expect(features().isPro.value).toBe(true);
    expect(features().isLocked("schedules")).toBe(false);
    expect(features().isLocked("marketplace")).toBe(false);
    wrapper.unmount();
  });

  it("gates nothing without an entitlement (not-configured / signed-out)", async () => {
    for (const kind of ["not-configured", "signed-out"]) {
      const { wrapper, features } = mountFeatures({ kind });
      await flushPromises();

      expect(features().hasEntitlement.value).toBe(false);
      expect(features().isPro.value).toBe(false);
      expect(features().isLocked("schedules")).toBe(false);
      expect(features().isLocked("memory")).toBe(false);
      wrapper.unmount();
    }
  });

  it("keeps the stored entitlement's locks while offline inside the grace window", async () => {
    const { wrapper, features } = mountFeatures({
      kind: "offline",
      email: "chad@vynel.app",
      displayName: "Chad",
      tier: "basic",
      features: ["channels"],
    });
    await flushPromises();

    expect(features().hasEntitlement.value).toBe(true);
    expect(features().isPro.value).toBe(false);
    expect(features().isLocked("channels")).toBe(false);
    expect(features().isLocked("knowledge")).toBe(true);
    wrapper.unmount();
  });

  it("gates nothing once the offline grace expired (tier null)", async () => {
    const { wrapper, features } = mountFeatures({
      kind: "offline",
      email: null,
      displayName: null,
      tier: null,
      features: [],
    });
    await flushPromises();

    expect(features().hasEntitlement.value).toBe(false);
    expect(features().isPro.value).toBe(false);
    expect(features().isLocked("schedules")).toBe(false);
    wrapper.unmount();
  });
});
