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

  it("lists a workspace's entries with kind chips, hiding archived ones", async () => {
    const client = {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      memory: {
        list: async () => ({
          entries: [
            makeEntry(),
            makeEntry({ id: "m2", isArchived: true, title: "Old" }),
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

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Invoice cadence");
    expect(wrapper.text()).toContain("Preference");
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
          entries: [],
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
    } as unknown as VynelClient;
  }

  function mountDialog(client: VynelClient) {
    return mount(AddMemoryDialog, {
      props: {
        open: true,
        defaultScope: { kind: "global" } satisfies SectionScope,
      },
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

  it("saves a memory into the chosen workspace with the kind's filing defaults", async () => {
    const createCalls: unknown[] = [];
    const wrapper = mountDialog(makeClient({ create: createCalls }));
    await flushPromises();

    const dialog = latestDialog();
    const body = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    body.value = "Invoices due on the 15th";
    body.dispatchEvent(new Event("input"));
    await flushPromises();

    clickButton(dialog, "Save memory");
    await flushPromises();

    expect(createCalls).toEqual([
      [
        "w1",
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
    // The tags read enables only once the workspace select is seeded.
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
        "w1",
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
      ["w1", { absolutePath: "C:\\Users\\KLONE\\notes.md" }],
    ]);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });
});
