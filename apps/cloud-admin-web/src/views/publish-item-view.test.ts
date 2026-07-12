import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import PublishItemView from "./PublishItemView.vue";
import { createAppRouter } from "../router.js";
import {
  clearAdminSession,
  storeAdminSession,
} from "../lib/admin-session-state.js";

/** Deterministic FileReader double — the real one is async host machinery. */
function stubFileReader() {
  class StubFileReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    result: string | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        this.result = "data:application/zip;base64,UEs=";
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("FileReader", StubFileReader);
}

async function mountView() {
  const router = createAppRouter();
  await router.push("/catalog/publish");
  await router.isReady();
  const wrapper = mount(PublishItemView, {
    global: {
      plugins: [
        router,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { mutations: { retry: false } },
            }),
          },
        ],
      ],
    },
  });
  return { wrapper, router };
}

function setField(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
  labelText: string,
  value: string,
) {
  const field = wrapper
    .findAll("label.field")
    .find((label) => label.text().includes(labelText));
  return field!.find("input, select, textarea").setValue(value);
}

async function fillAndSubmit(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
) {
  await setField(wrapper, "Item id", "daily-briefing");
  await setField(wrapper, "Display name", "Daily Briefing");
  await setField(wrapper, "One-line description", "A morning summary.");
  await setField(wrapper, "Category", "productivity");
  await setField(wrapper, "Icon name", "sunrise");
  await setField(wrapper, "Version (semver)", "1.0.0");
  const fileInput = wrapper.find('input[type="file"]');
  Object.defineProperty(fileInput.element, "files", {
    value: [new File(["zip"], "artifact.zip")],
    configurable: true,
  });
  await fileInput.trigger("change");
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

function manifestTextarea(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
) {
  const field = wrapper
    .findAll("label.field")
    .find((label) => label.text().includes("Manifest (JSON)"));
  return field!.find("textarea");
}

describe("PublishItemView", () => {
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

  it("submits the full publish body and routes to the new item", async () => {
    stubFileReader();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ itemId: "daily-briefing", version: "1.0.0" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper, router } = await mountView();
    await fillAndSubmit(wrapper);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/admin/catalog/publish");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.publisher).toEqual({
      id: "vynel-team",
      name: "Vynel Team",
      tier: "verified",
      url: null,
    });
    expect(body.item).toMatchObject({
      itemId: "daily-briefing",
      kind: "skill",
      status: "draft",
    });
    expect(body.version).toMatchObject({
      version: "1.0.0",
      manifest: { kind: "skill", entryFile: "SKILL.md" },
    });
    expect(body.artifactBase64).toBe("UEs=");
    // The success redirect lazy-loads the detail view — poll instead of
    // counting microtask flushes.
    await vi.waitFor(
      () => expect(router.currentRoute.value.name).toBe("catalog-item"),
      // Generous under full-suite parallel load — the lazy chunk import can
      // stall well past waitFor's 1s default (the argon2-flake sibling class).
      { timeout: 15_000 },
    );
    expect(router.currentRoute.value.params.itemId).toBe("daily-briefing");
  });

  it("surfaces the hub's 409 duplicate-version message verbatim", async () => {
    stubFileReader();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          code: "conflict",
          message: "Version 1.0.0 of daily-briefing already exists.",
        }),
      })),
    );

    const { wrapper } = await mountView();
    await fillAndSubmit(wrapper);

    expect(wrapper.text()).toContain(
      "Version 1.0.0 of daily-briefing already exists.",
    );
  });

  it("switches the manifest prefill with kind until the admin edits it", async () => {
    const { wrapper } = await mountView();

    expect(manifestTextarea(wrapper).element.value).toBe(
      '{"kind":"skill","entryFile":"SKILL.md"}',
    );
    await setField(wrapper, "Kind", "agent");
    expect(manifestTextarea(wrapper).element.value).toBe(
      '{"kind":"agent","entryFile":"agent.json"}',
    );

    await manifestTextarea(wrapper).setValue('{"custom":true}');
    await setField(wrapper, "Kind", "skill");
    expect(manifestTextarea(wrapper).element.value).toBe('{"custom":true}');
  });
});
