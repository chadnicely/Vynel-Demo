import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import SignInView from "./SignInView.vue";
import { createAppRouter } from "../router.js";
import { adminSession, clearAdminSession } from "../lib/admin-session-state.js";

const sessionBody = {
  accountId: "acc-1",
  email: "admin@vynel.dev",
  displayName: "Ada Admin",
  accessToken: "access-token-1",
  accessTokenExpiresAt: "2026-07-12T12:00:00.000Z",
  refreshToken: "refresh-token-1",
  entitlementToken: "entitlement-1",
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountSignIn() {
  const router = createAppRouter();
  await router.push("/sign-in");
  await router.isReady();
  // useAdminSession reads the query client (sign-out clears it) — the view
  // needs the plugin installed, exactly as main.ts does.
  const wrapper = mount(SignInView, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient() }]],
    },
  });
  return { wrapper, router };
}

describe("SignInView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAdminSession();
    vi.unstubAllGlobals();
  });

  it("signs in against the hub and stores the session", async () => {
    const fetchMock = stubFetch(sessionBody);
    const { wrapper, router } = await mountSignIn();

    await wrapper.find('input[type="email"]').setValue("admin@vynel.dev");
    await wrapper.find('input[type="password"]').setValue("correct horse");
    await wrapper.find("form").trigger("submit");
    await vi.dynamicImportSettled();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/auth/sign-in");
    const requestBody = JSON.parse(String(init.body)) as {
      email: string;
      password: string;
      device: { devicePlatform: string };
    };
    expect(requestBody.email).toBe("admin@vynel.dev");
    expect(requestBody.device.devicePlatform).toBe("web");

    expect(adminSession.value).toEqual({
      accessToken: "access-token-1",
      email: "admin@vynel.dev",
      displayName: "Ada Admin",
    });
    expect(sessionStorage.getItem("vynel-admin-session")).toContain(
      "access-token-1",
    );
    expect(router.currentRoute.value.name).toBe("catalog");
  });

  it("shows the hub's error message on bad credentials", async () => {
    stubFetch({ code: "invalid-credentials", message: "Wrong password." }, 401);
    const { wrapper } = await mountSignIn();

    await wrapper.find('input[type="email"]').setValue("admin@vynel.dev");
    await wrapper.find('input[type="password"]').setValue("nope");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Wrong password.");
    expect(adminSession.value).toBeNull();
  });
});
