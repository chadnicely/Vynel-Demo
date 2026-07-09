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
  it("aggregates every workspace's view on the global surface, deduping global sources", async () => {
    const client = {
      workspaces: {
        list: async () => [
          { id: "w1", name: "vynel", isArchived: false },
          { id: "w2", name: "blog", isArchived: false },
        ],
      },
      knowledge: {
        // The same global source appears in BOTH workspaces' views; w2 also
        // has its own source. The merge must yield exactly two rows.
        listSources: async (workspaceId: string) => ({
          sources:
            workspaceId === "w1"
              ? [makeSource()]
              : [
                  makeSource(),
                  makeSource({
                    id: "src2",
                    workspaceId: "w2",
                    scope: "workspace",
                    absolutePath: "C:\\blog\\posts",
                  }),
                ],
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mount(KnowledgeSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Notes");
    expect(wrapper.text()).toContain("posts");
    expect(wrapper.text()).toContain("Global");
    expect(wrapper.text()).toContain("blog");
  });

  it("invites the first folder when the vault is empty", async () => {
    const client = {
      workspaces: { list: async () => [] },
      knowledge: { listSources: async () => ({ sources: [] }) },
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
  it("lists a workspace's entries with kind chips, hiding archived ones", async () => {
    const client = {
      workspaces: { list: async () => [{ id: "w1", name: "vynel", isArchived: false }] },
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
      props: { scope: { kind: "workspace", workspaceId: "w1" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Invoice cadence");
    expect(wrapper.text()).toContain("Preference");
    expect(wrapper.text()).not.toContain("Old");
  });
});

describe("AddMemoryDialog", () => {
  it("saves a memory into the chosen workspace with the kind's filing defaults", async () => {
    const createCalls: unknown[] = [];
    const client = {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      memory: {
        create: async (workspaceId: string, body: unknown) => {
          createCalls.push([workspaceId, body]);
          return makeEntry();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mount(AddMemoryDialog, {
      props: { open: true, defaultScope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1]!;
    const body = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    body.value = "Invoices due on the 15th";
    body.dispatchEvent(new Event("input"));
    await flushPromises();

    [...dialog.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Save memory")!
      .click();
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
});
