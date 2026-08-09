// The review-queue view: inspect renders the plugin list with
// already-published rows unticked, and Approve posts exactly the ticked
// subset with the pinned facts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import ImportMarketplaceView from "./ImportMarketplaceView.vue";
import { createAppRouter } from "../router.js";
import { clearAdminSession, storeAdminSession } from "../lib/admin-session-state.js";

const INSPECTION = {
  repoUrl: "https://github.com/acme/tools",
  pinnedSha: "a".repeat(40),
  marketplaceName: "acme-tools",
  ownerName: "Acme Inc",
  description: "Acme plugins",
  plugins: [
    {
      pluginName: "invoicer",
      description: "Invoices",
      version: "1.1.0",
      category: "business",
      proposedItemId: "acme-tools-invoicer",
      alreadyPublished: false,
    },
    {
      pluginName: "old-plugin",
      description: null,
      version: null,
      category: null,
      proposedItemId: "acme-tools-old-plugin",
      alreadyPublished: true,
    },
  ],
};

function stubFetchRoutes() {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const respond = (payload: unknown, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => payload,
    });
    if (url === "/api/admin/catalog/inspect-claude-marketplace") return respond(INSPECTION);
    if (url === "/api/admin/catalog/import-claude-marketplace")
      return respond({
        items: [{ itemId: "acme-tools-invoicer", pluginName: "invoicer", outcome: "published" }],
      });
    return respond({ code: "not_found", message: `no stub for ${url}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountView() {
  const router = createAppRouter();
  await router.push("/catalog/import-marketplace");
  await router.isReady();
  return mount(ImportMarketplaceView, {
    global: {
      plugins: [
        router,
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  });
}

beforeEach(() => {
  clearAdminSession();
  storeAdminSession({
    accessToken: "t",
    email: "admin@vynel.app",
    displayName: "Ada Admin",
  });
});

describe("ImportMarketplaceView", () => {
  it("inspects, preselects only unpublished plugins, and approves the ticked subset", async () => {
    const fetchMock = stubFetchRoutes();
    const wrapper = await mountView();

    await wrapper.get("input[type=url]").setValue("https://github.com/acme/tools");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("acme-tools");
    expect(wrapper.text()).toContain("acme-tools-invoicer");
    const checkboxes = wrapper.findAll("input[type=checkbox]");
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1]!.element as HTMLInputElement).checked).toBe(false);

    await wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("Approve"))!
      .trigger("click");
    await flushPromises();

    const importCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url === "/api/admin/catalog/import-claude-marketplace",
    )!;
    const body = JSON.parse(importCall[1].body as string);
    expect(body).toEqual({
      url: "https://github.com/acme/tools",
      pinnedSha: "a".repeat(40),
      marketplaceName: "acme-tools",
      ownerName: "Acme Inc",
      selected: [
        { pluginName: "invoicer", description: "Invoices", version: "1.1.0", category: "business" },
      ],
    });
    expect(wrapper.text()).toContain("published 1");
    wrapper.unmount();
  });
});
