import { describe, expect, it } from "vitest";
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
  });
}

describe("JournalSection", () => {
  it("shows a workspace room only its own + global entries, grouped by day with writer chips", async () => {
    const client = {
      journalUser: {
        list: async () => [
          makeEntry({ entryDate: "2026-07-23" }),
          makeEntry({
            id: "j2",
            workspaceId: "w1",
            content: "Fixed the booking bug.",
            entryDate: "2026-07-22",
            source: "user",
          }),
          makeEntry({ id: "j3", workspaceId: "OTHER", content: "Elsewhere" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "workspace", workspaceId: "w1" }, client);
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(wrapper.text()).toContain("Shipped the newsletter draft.");
    expect(wrapper.text()).toContain("Fixed the booking bug.");
    expect(wrapper.text()).not.toContain("Elsewhere");
    // Two distinct days → two day-group headers.
    expect(wrapper.findAll(".day-label")).toHaveLength(2);
    // The chip says who wrote it — the user or the assistant.
    expect(wrapper.text()).toContain("You");
    expect(wrapper.text()).toContain("Claude");
  });

  it("appends from the inline composer with today's date default and clears it", async () => {
    const createCalls: unknown[] = [];
    const client = {
      journalUser: {
        list: async () => [],
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
      .get('[aria-label="Delete this journal entry"]')
      .trigger("click");
    await flushPromises();

    expect(deleteCalls).toEqual(["j1"]);
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
