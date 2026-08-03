import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import JournalSection from "./JournalSection.vue";
import { localDayKey } from "../../utils/format-day-label.js";
import type { SectionScope } from "./section-scope.js";

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    userId: "u1",
    workspaceId: null,
    entryDate: "2026-07-23",
    content: "Shipped the newsletter draft.",
    source: "assistant",
    sessionId: null,
    createdAt: "2026-07-23T10:00:00.000Z",
    updatedAt: "2026-07-23T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function mountSection(scope: SectionScope, client: VynelClient) {
  return mount(JournalSection, {
    props: { scope },
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
      provide: { [vynelClientKey as symbol]: client },
    },
    attachTo: document.body,
  });
}

describe("JournalSection", () => {
  // test: correct expectation for scope visibility — was "workspace = own +
  // global", now STRICT per Chad's rule (the channels convention): a workspace
  // room reads the server-filtered workspace route and lists only its own rows.
  it("a workspace room lists ONLY its own entries, grouped by day with writer chips", async () => {
    const listCalls: string[] = [];
    const client = {
      journal: {
        list: async (workspaceId: string) => {
          listCalls.push(workspaceId);
          return [
            makeEntry({
              id: "j2",
              workspaceId: "w1",
              entryDate: "2026-07-23",
            }),
            makeEntry({
              id: "j3",
              workspaceId: "w1",
              content: "Fixed the booking bug.",
              entryDate: "2026-07-22",
              source: "user",
            }),
          ];
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    expect(listCalls).toEqual(["w1"]);
    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Shipped the newsletter draft.");
    expect(wrapper.text()).toContain("Fixed the booking bug.");
    // Two distinct days → two day-group headers.
    expect(wrapper.findAll(".day-label")).toHaveLength(2);
    // The chip says who wrote it — the user or the assistant.
    expect(wrapper.text()).toContain("You");
    expect(wrapper.text()).toContain("Claude");
  });

  it("the global menu lists ONLY global (null-workspace) entries", async () => {
    const client = {
      journalUser: {
        list: async () => [
          makeEntry(),
          makeEntry({
            id: "j2",
            workspaceId: "w1",
            content: "Fixed the booking bug.",
          }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Shipped the newsletter draft.");
    expect(wrapper.text()).not.toContain("Fixed the booking bug.");
  });

  it("appends from the inline composer with today's date default and clears it", async () => {
    const createCalls: unknown[] = [];
    const client = {
      journal: { list: async () => [] },
      journalUser: {
        create: async (input: unknown) => {
          createCalls.push(input);
          return makeEntry({ id: "j9", workspaceId: "w1" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const textarea = wrapper.get('textarea[aria-label="New journal entry"]');
    await textarea.setValue("  Landed the pricing page.  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createCalls).toEqual([
      {
        scope: "workspace",
        workspaceId: "w1",
        content: "Landed the pricing page.",
        entryDate: localDayKey(),
      },
    ]);
    expect((textarea.element as HTMLTextAreaElement).value).toBe("");
  });

  it("deletes an entry from its hover-reveal control", async () => {
    const deleteCalls: unknown[] = [];
    const client = {
      journalUser: {
        list: async () => [makeEntry()],
        delete: async (entryId: string) => {
          deleteCalls.push(entryId);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Delete this 2026-07-23 journal entry"]')
      .trigger("click");
    await flushPromises();

    expect(deleteCalls).toEqual(["j1"]);
  });

  it("View opens the full-entry dialog", async () => {
    const client = {
      journalUser: {
        list: async () => [
          makeEntry({ content: "A long record of the day's work." }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="View this 2026-07-23 journal entry"]')
      .trigger("click");
    await flushPromises();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("A long record of the day's work.");
    expect(dialog?.textContent).toContain("2026-07-23");
  });

  it("Edit opens the edit dialog prefilled and saves the patch", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      journalUser: {
        list: async () => [makeEntry()],
        update: async (entryId: string, patch: unknown) => {
          updateCalls.push([entryId, patch]);
          return makeEntry({ content: "Corrected" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Edit this 2026-07-23 journal entry"]')
      .trigger("click");
    await flushPromises();

    // Scope to the dialog — the section's own composer is also in body.
    expect(document.body.textContent).toContain("Edit journal entry");
    const contentInput = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    );
    expect(contentInput?.value).toBe("Shipped the newsletter draft.");

    contentInput!.value = "Corrected";
    contentInput!.dispatchEvent(new Event("input", { bubbles: true }));
    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Save");
    save!.click();
    await flushPromises();

    expect(updateCalls).toEqual([
      ["j1", { content: "Corrected", entryDate: "2026-07-23" }],
    ]);
  });

  it("invites writing when there is nothing yet", async () => {
    const client = {
      journalUser: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("No entries yet");
  });
});
