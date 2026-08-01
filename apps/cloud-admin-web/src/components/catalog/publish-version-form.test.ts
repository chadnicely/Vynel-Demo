import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import PublishVersionForm from "./PublishVersionForm.vue";

const item: HubAdminCatalogItem = {
  itemId: "daily-briefing",
  kind: "skill",
  status: "published",
  publisherId: "acme",
  publisherName: "Acme Tools",
  publisherTier: "community",
  publisherUrl: "https://acme.dev",
  displayName: "Daily Briefing",
  oneLineDescription: "A morning summary.",
  category: "productivity",
  iconName: "sunrise",
  recommendedScope: "user",
  sourceUrl: "https://github.com/acme/tools/tree/abc1234/daily-briefing",
  minimumTier: "basic",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
  versions: [],
};

/** Deterministic FileReader double — the real one is async host machinery. */
function stubFileReader(mode: "load" | "error" | "abort") {
  class StubFileReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    result: string | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        if (mode === "error") this.onerror?.();
        else if (mode === "abort") this.onabort?.();
        else {
          this.result = "data:application/zip;base64,UEs=";
          this.onload?.();
        }
      });
    }
  }
  vi.stubGlobal("FileReader", StubFileReader);
}

function mountForm() {
  return mount(PublishVersionForm, {
    props: { item },
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
    },
  });
}

async function fillAndSubmit(wrapper: ReturnType<typeof mountForm>) {
  await wrapper.find('input[type="text"]').setValue("1.0.0");
  const fileInput = wrapper.find('input[type="file"]');
  Object.defineProperty(fileInput.element, "files", {
    value: [new File(["zip"], "artifact.zip")],
    configurable: true,
  });
  await fileInput.trigger("change");
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

describe("PublishVersionForm", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("surfaces a file-read failure instead of rejecting unhandled", async () => {
    stubFileReader("error");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountForm();
    await fillAndSubmit(wrapper);

    expect(wrapper.text()).toContain("Could not read the zip file.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces an aborted read the same way (the promise must settle)", async () => {
    stubFileReader("abort");
    vi.stubGlobal("fetch", vi.fn());

    const wrapper = mountForm();
    await fillAndSubmit(wrapper);

    expect(wrapper.text()).toContain("Reading the zip file was aborted.");
  });

  it("republishes the item's CURRENT publisher and sourceUrl verbatim", async () => {
    // The regression this pins: the version-bump body once hardcoded the
    // vynel-team publisher and omitted sourceUrl — every bump silently
    // re-tiered the publisher and nulled the item's credit link.
    stubFileReader("load");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ itemId: item.itemId, version: "1.0.0" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountForm();
    await fillAndSubmit(wrapper);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.publisher).toEqual({
      id: "acme",
      name: "Acme Tools",
      tier: "community",
      url: "https://acme.dev",
    });
    expect(body.item).toMatchObject({
      sourceUrl: "https://github.com/acme/tools/tree/abc1234/daily-briefing",
    });
  });

  it("resets the picked file — state AND the DOM input — after publishing", async () => {
    stubFileReader("load");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ itemId: item.itemId, version: "1.0.0" }),
      })),
    );

    const wrapper = mountForm();
    await fillAndSubmit(wrapper);

    expect(wrapper.text()).toContain("Published 1.0.0.");
    const fileInput = wrapper.find('input[type="file"]')
      .element as HTMLInputElement;
    expect(fileInput.value).toBe("");
    // The state reset is observable: a second submit demands a fresh file.
    await wrapper.find('input[type="text"]').setValue("1.0.1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Pick the artifact zip first.");
  });
});
