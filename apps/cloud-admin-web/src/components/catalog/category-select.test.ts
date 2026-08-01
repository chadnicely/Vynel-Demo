import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { BASELINE_CATALOG_CATEGORIES } from "@vynel/contracts/marketplace/catalog-categories";
import CategorySelect from "./CategorySelect.vue";
import { storeAdminSession, clearAdminSession } from "../../lib/admin-session-state.js";

function stubCatalog(categories: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: categories.map((category, index) => ({
          itemId: `item-${index}`,
          category,
        })),
      }),
    })),
  );
}

async function mountSelect(modelValue = "") {
  const wrapper = mount(CategorySelect, {
    props: { modelValue },
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
    },
  });
  await flushPromises();
  return wrapper;
}

describe("CategorySelect", () => {
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

  it("offers the baseline union the live catalog's categories, sorted", async () => {
    stubCatalog(["data-science", "email"]);
    const wrapper = await mountSelect();
    const options = wrapper
      .findAll("option")
      .map((o) => o.attributes("value"))
      .filter((v) => v !== "" && v !== "__new__");
    expect(options).toEqual(
      [...new Set([...BASELINE_CATALOG_CATEGORIES, "data-science"])].sort(),
    );
  });

  it("keeps an item's off-list current category selectable", async () => {
    stubCatalog([]);
    const wrapper = await mountSelect("legacy-category");
    expect(
      wrapper.findAll("option").some((o) => o.attributes("value") === "legacy-category"),
    ).toBe(true);
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe(
      "legacy-category",
    );
  });

  it("'+ new category' reveals an input and emits the NORMALIZED value", async () => {
    stubCatalog([]);
    const wrapper = await mountSelect();
    await wrapper.find("select").setValue("__new__");
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);

    await input.setValue("  Data Science ");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["data-science"]);
  });
});
