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

/** URL-dispatching fetch double — the view now also reads /admin/catalog
 *  (the category/publisher pickers derive their options from it). */
function stubFetchRoutes(overrides: Record<string, () => unknown> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const respond = (payload: unknown, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => payload,
    });
    for (const [path, payload] of Object.entries(overrides)) {
      if (url === `/api${path}`) return respond(payload());
    }
    if (url === "/api/admin/catalog") return respond({ items: [] });
    return respond({ code: "not_found", message: `no stub for ${url}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls.filter(([url]) => url === `/api${path}`) as unknown as Array<
    [string, RequestInit]
  >;
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
              defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false },
              },
            }),
          },
        ],
      ],
    },
  });
  await flushPromises();
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

async function fillCommonFields(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
) {
  await setField(wrapper, "Item id", "daily-briefing");
  await setField(wrapper, "Display name", "Daily Briefing");
  await setField(wrapper, "One-line description", "A morning summary.");
  await wrapper.find('select[aria-label="Category"]').setValue("email");
  await wrapper.find('.icon-cell[title="mail"]').trigger("click");
  await setField(wrapper, "Version (semver)", "1.0.0");
}

async function fillAndSubmitZip(
  wrapper: Awaited<ReturnType<typeof mountView>>["wrapper"],
) {
  await fillCommonFields(wrapper);
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
    const fetchMock = stubFetchRoutes({
      "/admin/catalog/publish": () => ({ itemId: "daily-briefing", version: "1.0.0" }),
    });

    const { wrapper, router } = await mountView();
    await fillAndSubmitZip(wrapper);

    const calls = callsTo(fetchMock, "/admin/catalog/publish");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]![1].body as string) as Record<string, unknown>;
    // Empty catalog → the picker's new-publisher form prefilled with the
    // house identity.
    expect(body.publisher).toEqual({
      id: "vynel-team",
      name: "Vynel Team",
      tier: "verified",
      url: null,
    });
    expect(body.item).toMatchObject({
      itemId: "daily-briefing",
      kind: "skill",
      category: "email",
      iconName: "mail",
      sourceUrl: null,
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
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/catalog")
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return {
        ok: false,
        status: 409,
        json: async () => ({
          code: "conflict",
          message: "Version 1.0.0 of daily-briefing already exists.",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = await mountView();
    await fillAndSubmitZip(wrapper);

    expect(wrapper.text()).toContain(
      "Version 1.0.0 of daily-briefing already exists.",
    );
  });

  it("switches the manifest prefill with kind until the admin edits it", async () => {
    stubFetchRoutes();
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

  it("repo mode: inspect prefills the form, submit posts to publish-from-repo", async () => {
    const pin = "b".repeat(40);
    const fetchMock = stubFetchRoutes({
      "/admin/catalog/inspect-repo": () => ({
        resolvedSha: pin,
        sourceUrl: `https://github.com/anthropics/skills/tree/${pin}/skills/canvas-design`,
        manifest: {
          publisher: {
            id: "anthropic",
            name: "Anthropic",
            tier: "anthropic-official",
            url: "https://www.anthropic.com",
          },
          item: {
            itemId: "canvas-design",
            kind: "skill",
            displayName: "Canvas Design",
            oneLineDescription: "Designs canvases.",
            category: "creative",
            iconName: "palette",
          },
          version: { version: "1.0.0" },
        },
        detectedKind: "skill",
        entryFile: "SKILL.md",
      }),
      "/admin/catalog/publish-from-repo": () => ({
        itemId: "canvas-design",
        version: "1.0.0",
        resolvedSha: pin,
        sourceUrl: `https://github.com/anthropics/skills/tree/${pin}/skills/canvas-design`,
        bytes: 1234,
      }),
    });

    const { wrapper } = await mountView();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "From GitHub URL")!
      .trigger("click");

    await setField(wrapper, "GitHub repo URL", "https://github.com/anthropics/skills");
    await setField(wrapper, "Branch / tag / commit", "main");
    await setField(wrapper, "Folder in repo", "skills/canvas-design");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Inspect")!
      .trigger("click");
    await flushPromises();

    // The manifest prefilled the form — including the "By Anthropic"-style
    // publisher and the pin-anchored credit link.
    const displayName = wrapper
      .findAll("label.field")
      .find((label) => label.text().includes("Display name"))!
      .find("input").element as HTMLInputElement;
    expect(displayName.value).toBe("Canvas Design");
    expect(wrapper.text()).toContain("vynel-item.json found");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const calls = callsTo(fetchMock, "/admin/catalog/publish-from-repo");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.repo).toEqual({
      url: "https://github.com/anthropics/skills",
      ref: "main",
      subpath: "skills/canvas-design",
    });
    expect(body.publisher).toEqual({
      id: "anthropic",
      name: "Anthropic",
      tier: "anthropic-official",
      url: "https://www.anthropic.com",
    });
    expect(body.item).toMatchObject({
      itemId: "canvas-design",
      category: "creative",
      iconName: "palette",
      sourceUrl: `https://github.com/anthropics/skills/tree/${pin}/skills/canvas-design`,
    });
    expect(body).not.toHaveProperty("artifactBase64");
  });
});
