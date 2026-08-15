import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { TOOL_CATALOG_SNAPSHOT } from "@vynel/contracts/generated/tool-catalog-snapshot";
import type { ToolPolicyDefault } from "@vynel/contracts/tool-policy/defaults";
import ToolPolicyView from "./ToolPolicyView.vue";
import { createAppRouter } from "../router.js";
import {
  clearAdminSession,
  storeAdminSession,
} from "../lib/admin-session-state.js";

const MAP_VERSION = "c0ffee".repeat(10) + "beef";

function makeOverride(
  overrides: Partial<ToolPolicyDefault>,
): ToolPolicyDefault {
  return {
    toolName: "mcp__desktop__act_on_app",
    enabled: false,
    cardClass: null,
    surfaces: null,
    featureKey: null,
    capabilityId: null,
    ...overrides,
  };
}

function stubToolPolicyFetch(overrides: ToolPolicyDefault[]) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const respond = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });
      if (url === "/api/admin/tool-policy/map" && method === "GET") {
        return respond({
          version: MAP_VERSION,
          generatedAt: "2026-08-01T00:00:00.000Z",
          defaults: overrides,
        });
      }
      if (url === "/api/admin/tool-policy" && method === "GET") {
        return respond({ defaults: overrides });
      }
      if (url.startsWith("/api/admin/tool-policy/")) {
        if (method === "PUT" || method === "DELETE") {
          return respond({ default: null });
        }
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountToolPolicy() {
  const router = createAppRouter();
  await router.push("/tool-policy");
  await router.isReady();
  const wrapper = mount(ToolPolicyView, {
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

function findRow(
  wrapper: Awaited<ReturnType<typeof mountToolPolicy>>,
  shortName: string,
) {
  return wrapper
    .findAll("tr.policy-row")
    .find((row) => row.find(".tool-cell").text() === shortName);
}

describe("ToolPolicyView", () => {
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

  it("renders every snapshot tool grouped by server, with the map stamp", async () => {
    stubToolPolicyFetch([makeOverride({})]);

    const wrapper = await mountToolPolicy();

    expect(wrapper.findAll("tr.policy-row")).toHaveLength(
      TOOL_CATALOG_SNAPSHOT.length,
    );
    const serverNames = [
      ...new Set(TOOL_CATALOG_SNAPSHOT.map((entry) => entry.serverName)),
    ];
    const headings = wrapper.findAll(".server-name").map((h) => h.text());
    for (const serverName of serverNames) {
      expect(headings.some((text) => text.startsWith(serverName))).toBe(true);
    }
    expect(wrapper.text()).toContain(MAP_VERSION.slice(0, 12));
  });

  it("marks the overridden row as customized and shows its effective value", async () => {
    stubToolPolicyFetch([makeOverride({ enabled: false })]);

    const wrapper = await mountToolPolicy();

    const overriddenRow = findRow(wrapper, "act_on_app");
    expect(overriddenRow!.text()).toContain("customized");
    expect(overriddenRow!.text()).toContain("off");
    expect(wrapper.findAll(".chip-customized")).toHaveLength(1);
  });

  it("saves a PUT body with nulls for every untouched (inherit) field", async () => {
    const fetchMock = stubToolPolicyFetch([]);

    const wrapper = await mountToolPolicy();
    await findRow(wrapper, "act_on_desktop")!.trigger("click");

    const editForm = wrapper.find("form.edit-card");
    const cardClassSelect = editForm.findAll("select")[1]!;
    await cardClassSelect.setValue("always");
    await editForm.trigger("submit");
    await flushPromises();

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(String(putCall![0])).toBe(
      "/api/admin/tool-policy/mcp__desktop__act_on_desktop",
    );
    expect(JSON.parse(String(putCall![1]!.body))).toEqual({
      enabled: null,
      cardClass: "always",
      surfaces: null,
      featureKey: null,
      capabilityId: null,
    });
  });

  it("resets an override with DELETE", async () => {
    const fetchMock = stubToolPolicyFetch([makeOverride({})]);

    const wrapper = await mountToolPolicy();
    await findRow(wrapper, "act_on_app")!
      .find(".reset-button")
      .trigger("click");
    await flushPromises();

    const deleteCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
    expect(String(deleteCall![0])).toBe(
      "/api/admin/tool-policy/mcp__desktop__act_on_app",
    );
  });

  it("filters rows by name without dropping empty groups' peers", async () => {
    stubToolPolicyFetch([]);

    const wrapper = await mountToolPolicy();
    await wrapper.find(".filter-input").setValue("act_on_app");

    expect(wrapper.findAll("tr.policy-row")).toHaveLength(1);
    expect(wrapper.find(".tool-cell").text()).toBe("act_on_app");
  });
});
