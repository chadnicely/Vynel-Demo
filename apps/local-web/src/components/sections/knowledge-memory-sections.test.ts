import { describe, expect, it } from "vitest";
import { flushPromises, mount, type MountingOptions } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import KnowledgeSection from "./KnowledgeSection.vue";
import MemorySection from "./MemorySection.vue";
import AddMemoryDialog from "./AddMemoryDialog.vue";
import type { SectionScope } from "./section-scope.js";

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "src1",
    userId: "u1",
    workspaceId: null,
    scope: "global",
    absolutePath: "C:\\Users\\KLONE\\Documents\\Notes",
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    userId: "u1",
    workspaceId: "w1",
    kind: "preference",
    title: "Invoice cadence",
    body: "Invoices are always due on the 15th.",
    category: "preferences",
    section: "Preferences",
    sourceMessageId: null,
    createdSource: "user-manual",
    embeddingPresent: false,
    embeddingModelVersion: null,
    isArchived: false,
    tags: [],
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    lastMentionedAt: null,
    ...overrides,
  };
}

function globalConfig(
  client: VynelClient,
): NonNullable<MountingOptions<unknown>["global"]> {
  return {
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
    provide: { [vynelClientKey as symbol]: client },
  };
}

describe("KnowledgeSection", () => {
  // test: correct expectation for scope visibility — was "the global surface
  // aggregates every workspace's view" (it rendered w2's own source under
  // Global), now "ONLY the user's global sources", read off the user-scoped
  // route. Codifies the settled Global = workspaceId IS NULL rule.
  it("the global menu lists ONLY the user's global sources", async () => {
    const client = {
      knowledgeUser: {
        listSources: async () => ({ sources: [makeSource()] }),
      },
      // A fan-out over workspaces would throw here — the global surface has
      // its own anchor now and must never reach for the workspace route.
      workspaces: {
        list: async () => {
          throw new Error("the global surface must not fan out per workspace");
        },
      },
    } as unknown as VynelClient;

    const wrapper = mount(KnowledgeSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Notes");
    expect(wrapper.text()).toContain("Global");
  });

  it("a workspace surface keeps the route's fusion — its own + the global ones", async () => {
    const client = {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      knowledge: {
        listSources: async () => ({
          sources: [
            makeSource(),
            makeSource({
              id: "src2",
              workspaceId: "w1",
              scope: "workspace",
              absolutePath: "C:\\blog\\posts",
            }),
          ],
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mount(KnowledgeSection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } satisfies SectionScope,
      },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Notes");
    expect(wrapper.text()).toContain("posts");
  });

  it("invites the first folder when the vault is empty", async () => {
    const client = {
      workspaces: { list: async () => [] },
      knowledgeUser: { listSources: async () => ({ sources: [] }) },
    } as unknown as VynelClient;

    const wrapper = mount(KnowledgeSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.text()).toContain("The vault is empty");
    expect(wrapper.find(".invite-button").text()).toContain("Add a folder");
  });
});

describe("MemorySection", () => {
  it("the global menu reads the user-scoped route — global entries only", async () => {
    const client = {
      memoryUser: {
        list: async () => ({
          entries: [makeEntry({ workspaceId: null })],
          nextCursor: null,
        }),
      },
      // A fan-out over workspaces would throw here — the global surface has
      // its own anchor now and must never reach for the workspace route.
      workspaces: {
        list: async () => {
          throw new Error("the global surface must not fan out per workspace");
        },
      },
    } as unknown as VynelClient;

    const wrapper = mount(MemorySection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Invoice cadence");
  });

  // SPEC CHANGE (2026-08-03): tags are the taxonomy now, so the row's chip
  // stopped naming the memory's KIND (Preference / Person / …) and names how it
  // got here instead — Text for anything written, File for an import. Both
  // entry types wear the chip.
  it("chips each entry by how it arrived, hiding archived ones", async () => {
    const client = {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      memory: {
        list: async () => ({
          entries: [
            makeEntry(),
            makeEntry({
              id: "m2",
              title: "Handbook",
              createdSource: "file-import",
            }),
            makeEntry({ id: "m3", isArchived: true, title: "Old" }),
          ],
          nextCursor: null,
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mount(MemorySection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } satisfies SectionScope,
      },
      global: globalConfig(client),
    });
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Invoice cadence");
    expect(rows[0]!.find(".source-chip").text()).toBe("Text");
    expect(rows[1]!.find(".source-chip").text()).toBe("File");
    // The old kind vocabulary is gone from the row entirely.
    expect(wrapper.text()).not.toContain("Preference");
    expect(wrapper.text()).not.toContain("Old");
  });

  it("shows an entry's tags as chips, marking context", async () => {
    const client = {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      memory: {
        list: async () => ({
          entries: [makeEntry({ tags: ["context", "billing"] })],
          nextCursor: null,
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mount(MemorySection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } satisfies SectionScope,
      },
      global: globalConfig(client),
    });
    await flushPromises();

    const tagChips = wrapper.findAll(".tag-chip");
    expect(tagChips.map((chip) => chip.text())).toEqual(["context", "billing"]);
    expect(tagChips[0]!.classes()).toContain("is-context");
    expect(tagChips[0]!.find(".context-dot").exists()).toBe(true);
  });
});

describe("AddMemoryDialog", () => {
  function makeClient(calls: { create?: unknown[]; importFile?: unknown[] }) {
    return {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
        listDirectories: async () => ({
          path: "C:\\Users\\KLONE",
          parent: null,
          drives: [],
          places: [],
          entries: [{ name: "Archive", path: "C:\\Users\\KLONE\\Archive" }],
          files: [{ name: "notes.md", path: "C:\\Users\\KLONE\\notes.md" }],
        }),
      },
      memory: {
        listTags: async () => ({ tags: ["context", "reminder"] }),
        create: async (workspaceId: string, body: unknown) => {
          calls.create?.push([workspaceId, body]);
          return makeEntry();
        },
        importFile: async (workspaceId: string, body: unknown) => {
          calls.importFile?.push([workspaceId, body]);
          return makeEntry();
        },
      },
      // The user-level twin: no workspace argument at all. A global write that
      // reached `memory.*` would be filed in some arbitrary room, so the two
      // namespaces stay separate in the fake exactly as they are on the wire.
      memoryUser: {
        listTags: async () => ({ tags: ["context", "reminder"] }),
        create: async (body: unknown) => {
          calls.create?.push([null, body]);
          return makeEntry({ workspaceId: null });
        },
        importFile: async (body: unknown) => {
          calls.importFile?.push([null, body]);
          return makeEntry({ workspaceId: null });
        },
      },
    } as unknown as VynelClient;
  }

  function mountDialog(
    client: VynelClient,
    scope: SectionScope = { kind: "global" },
  ) {
    return mount(AddMemoryDialog, {
      props: { open: true, defaultScope: scope },
      global: globalConfig(client),
    });
  }

  function latestDialog() {
    const dialogs =
      document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
    return dialogs[dialogs.length - 1]!;
  }

  function clickButton(dialog: HTMLElement, label: string) {
    [...dialog.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === label)!
      .click();
  }

  // SPEC CHANGE (2026-08-03): global memory became USER-level — an entry with
  // no workspace anchor at all. The Global menu therefore stopped asking which
  // workspace to file into (it used to pick one silently) and writes through
  // the user-scoped routes instead.
  it("files into the open workspace without asking which one", async () => {
    const createCalls: unknown[] = [];
    mountDialog(makeClient({ create: createCalls }), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    const dialog = latestDialog();
    expect(dialog.querySelector("select")).toBeNull();

    const body = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    body.value = "Standup is at 9.";
    body.dispatchEvent(new Event("input"));
    await flushPromises();

    clickButton(dialog, "Save memory");
    await flushPromises();

    expect(createCalls).toHaveLength(1);
    expect((createCalls[0] as [string, unknown])[0]).toBe("w1");
  });

  it("writes a user-level memory from the Global menu, asking nothing", async () => {
    const createCalls: unknown[] = [];
    const wrapper = mountDialog(makeClient({ create: createCalls }));
    await flushPromises();

    const dialog = latestDialog();
    expect(dialog.querySelector("select")).toBeNull();
    // No Kind picker either — tags are the taxonomy now.
    expect(dialog.textContent).not.toContain("Business fact");

    const body = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    body.value = "Invoices due on the 15th";
    body.dispatchEvent(new Event("input"));
    await flushPromises();

    clickButton(dialog, "Save memory");
    await flushPromises();

    // `null` marks the user-scoped route — no workspace argument exists there.
    expect(createCalls).toEqual([
      [
        null,
        {
          kind: "note",
          body: "Invoices due on the 15th",
          category: "memory",
          section: "Notes",
        },
      ],
    ]);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("sends toggled and freshly coined tags with the create", async () => {
    const createCalls: unknown[] = [];
    mountDialog(makeClient({ create: createCalls }));
    await flushPromises();

    const dialog = latestDialog();
    const body = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    body.value = "Invoices due on the 15th";
    body.dispatchEvent(new Event("input"));
    await flushPromises();

    clickButton(dialog, "context");
    const newTag = dialog.querySelector<HTMLInputElement>(".new-tag-input")!;
    newTag.value = " Billing ";
    newTag.dispatchEvent(new Event("input"));
    await flushPromises();
    dialog.querySelector<HTMLButtonElement>(".new-tag-add")!.click();
    await flushPromises();

    clickButton(dialog, "Save memory");
    await flushPromises();

    expect(createCalls).toEqual([
      [
        null,
        {
          kind: "note",
          body: "Invoices due on the 15th",
          category: "memory",
          section: "Notes",
          tags: ["context", "billing"],
        },
      ],
    ]);
  });

  it("imports a picked file in from-a-file mode", async () => {
    const importCalls: unknown[] = [];
    const wrapper = mountDialog(makeClient({ importFile: importCalls }));
    await flushPromises();

    const dialog = latestDialog();
    clickButton(dialog, "From a file");
    await flushPromises();

    clickButton(dialog, "notes.md");
    await flushPromises();

    clickButton(dialog, "Import file");
    await flushPromises();

    expect(importCalls).toEqual([
      [null, { absolutePath: "C:\\Users\\KLONE\\notes.md" }],
    ]);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("a highlighted folder is never the import — only a file enables Import", async () => {
    mountDialog(makeClient({}));
    await flushPromises();
    const dialog = latestDialog();
    clickButton(dialog, "From a file");
    await flushPromises();

    const importButton = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Import file",
    )!;
    clickButton(dialog, "Archive");
    await flushPromises();
    expect(importButton.disabled).toBe(true);

    // The habit: double-clicking the file. Two clicks must leave it selected.
    const file = [...dialog.querySelectorAll<HTMLButtonElement>("button.fs-tile")].find(
      (b) => b.textContent?.trim() === "notes.md",
    )!;
    file.click();
    file.click();
    file.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();
    expect(importButton.disabled).toBe(false);
  });

  it("imports into the open workspace when opened from a room", async () => {
    const importCalls: unknown[] = [];
    mountDialog(makeClient({ importFile: importCalls }), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    const dialog = latestDialog();
    clickButton(dialog, "From a file");
    await flushPromises();
    clickButton(dialog, "notes.md");
    await flushPromises();
    clickButton(dialog, "Import file");
    await flushPromises();

    expect(importCalls).toEqual([
      ["w1", { absolutePath: "C:\\Users\\KLONE\\notes.md" }],
    ]);
  });
});
