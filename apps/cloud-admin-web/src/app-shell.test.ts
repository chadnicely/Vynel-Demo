import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { createAppRouter } from "./router.js";
import {
  adminSession,
  clearAdminSession,
  storeAdminSession,
} from "./lib/admin-session-state.js";

async function mountShell() {
  const router = createAppRouter();
  await router.push("/catalog");
  await router.isReady();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = mount(App, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient }]],
    },
  });
  await vi.dynamicImportSettled();
  await flushPromises();
  return { wrapper, router, queryClient };
}

describe("app shell", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAdminSession();
    storeAdminSession({
      accessToken: "member-token",
      email: "member@vynel.dev",
      displayName: "Mia Member",
    });
    vi.unstubAllGlobals();
  });

  it("swaps to the not-an-admin card when an admin call answers 403", async () => {
    // A member CAN sign in — auth is the generic hub surface; the admin gate
    // is per-request, so the shell only learns on the first /admin call.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          code: "forbidden",
          message: "Admin role required.",
        }),
      })),
    );

    const { wrapper, router, queryClient } = await mountShell();

    expect(wrapper.text()).toContain("This account isn't an admin");
    const staleQueries = queryClient.getQueryCache().getAll();
    expect(staleQueries.length).toBeGreaterThan(0);

    await wrapper.find("button").trigger("click");
    // The sign-out redirect lazy-loads SignInView — settle it first.
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(adminSession.value).toBeNull();
    expect(router.currentRoute.value.name).toBe("sign-in");
    // Sign-out cleared the cache — this account's queries are gone, so the
    // next account on this tab can't flash the previous account's catalog.
    // (A shell re-render may file a FRESH query before the redirect lands;
    // only the stale instances matter.)
    const remaining = queryClient.getQueryCache().getAll();
    for (const stale of staleQueries) {
      expect(remaining).not.toContain(stale);
    }
  });
});
