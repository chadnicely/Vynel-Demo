import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import CatalogView from "./CatalogView.vue";
import { createAppRouter } from "../router.js";
import {
  clearAdminSession,
  storeAdminSession,
} from "../lib/admin-session-state.js";

function makeItem(
  overrides: Partial<HubAdminCatalogItem>,
): HubAdminCatalogItem {
  return {
    itemId: "daily-briefing",
    kind: "skill",
    status: "published",
    publisherId: "vynel-team",
    publisherName: "Vynel Team",
    publisherTier: "verified",
    displayName: "Daily Briefing",
    oneLineDescription: "A morning summary.",
    category: "productivity",
    iconName: "sunrise",
    recommendedScope: "user",
    minimumTier: "basic",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    versions: [
      {
        version: "1.2.0",
        changelog: "",
        artifactSha256: "a".repeat(64),
        artifactSize: 2048,
        minAppVersion: null,
        releasedAt: "2026-07-10T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

async function mountCatalog() {
  const router = createAppRouter();
  await router.push("/catalog");
  await router.isReady();
  const wrapper = mount(CatalogView, {
    global: {
      plugins: [
        router,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
    },
  });
  await flushPromises();
  return wrapper;
}

describe("CatalogView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAdminSession();
    storeAdminSession({
      accessToken: "access-token-1",
      email: "admin@vynel.dev",
      displayName: "Ada Admin",
    });
    vi.unstubAllGlobals();
  });

  it("renders every item and sends the bearer", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          makeItem({}),
          makeItem({
            itemId: "repo-scout",
            kind: "agent",
            displayName: "Repo Scout",
          }),
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = await mountCatalog();

    expect(wrapper.text()).toContain("Daily Briefing");
    expect(wrapper.text()).toContain("Repo Scout");
    expect(wrapper.text()).toContain("1.2.0");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/admin/catalog");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer access-token-1",
    );
  });

  it("filters rows by kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            makeItem({}),
            makeItem({
              itemId: "repo-scout",
              kind: "agent",
              displayName: "Repo Scout",
            }),
          ],
        }),
      })),
    );

    const wrapper = await mountCatalog();
    const agentTab = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "agent");
    await agentTab!.trigger("click");

    expect(wrapper.text()).toContain("Repo Scout");
    expect(wrapper.text()).not.toContain("Daily Briefing");
  });
});
