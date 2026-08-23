import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import PhasesSection from "./PhasesSection.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

function makePhase(overrides: Record<string, unknown> = {}) {
  return {
    id: "ph1",
    userId: "u1",
    workspaceId: "w1",
    title: "Foundations",
    descriptionPreview: "Schema, auth, the walking skeleton.",
    orderIndex: 0,
    status: "open",
    sessionId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function mountSection(client: VynelClient) {
  return mount(PhasesSection, {
    props: { workspaceId: "w1" },
    global: {
      plugins: [
        createPinia(),
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

describe("PhasesSection", () => {
  it("lists the workspace's phases in build order with ordinal chips", async () => {
    const listCalls: string[] = [];
    const client = {
      phases: {
        list: async (workspaceId: string) => {
          listCalls.push(workspaceId);
          // Deliberately out of order — the section sorts by orderIndex.
          return [
            makePhase({ id: "ph2", title: "Polish", orderIndex: 1 }),
            makePhase(),
          ];
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(listCalls).toEqual(["w1"]);
    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Foundations");
    expect(rows[1]!.text()).toContain("Polish");
    expect(
      wrapper.findAll(".phase-ordinal").map((chip) => chip.text()),
    ).toEqual(["1", "2"]);
  });

  it("cycles status in place: open starts, in-progress completes", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      phases: {
        list: async () => [
          makePhase(),
          makePhase({ id: "ph2", title: "Already rolling", status: "in-progress", orderIndex: 1 }),
        ],
        update: async (workspaceId: string, phaseId: string, patch: unknown) => {
          updateCalls.push([workspaceId, phaseId, patch]);
          return makePhase({ status: "in-progress" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    // The shared status control speaks "phase" here (the noun prop).
    await wrapper.get('[aria-label="Start this phase"]').trigger("click");
    await wrapper.get('[aria-label="Mark this phase done"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([
      ["w1", "ph1", { status: "in-progress" }],
      ["w1", "ph2", { status: "done" }],
    ]);
  });

  it("deletes a row from its hover-reveal control", async () => {
    const deleteCalls: unknown[] = [];
    const client = {
      phases: {
        list: async () => [makePhase()],
        remove: async (workspaceId: string, phaseId: string) => {
          deleteCalls.push([workspaceId, phaseId]);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Delete Foundations"]').trigger("click");
    await flushPromises();

    expect(deleteCalls).toEqual([["w1", "ph1"]]);
  });

  it("creates through the dialog — a phase's description is big-form, so there is no one-line composer", async () => {
    const createCalls: unknown[] = [];
    const client = {
      phases: {
        list: async () => [],
        create: async (workspaceId: string, body: unknown) => {
          createCalls.push([workspaceId, body]);
          return makePhase();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('button[type="button"]').trigger("click"); // "New phase" (the header's only action)
    await flushPromises();

    expect(document.body.textContent).toContain("New phase");
    const titleInput = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="text"]',
    )!;
    titleInput.value = "Foundations";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    const descriptionInput = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    )!;
    descriptionInput.value = "Schema, auth, the walking skeleton.";
    descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    const create = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Create");
    create!.click();
    await flushPromises();

    expect(createCalls).toEqual([
      [
        "w1",
        {
          title: "Foundations",
          description: "Schema, auth, the walking skeleton.",
        },
      ],
    ]);
  });

  it("Edit fetches the FULL description (the list only carries a preview) and saves the patch", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      phases: {
        list: async () => [makePhase()],
        get: async () => ({
          ...makePhase(),
          description: "The full write-up, well past the preview.",
        }),
        update: async (workspaceId: string, phaseId: string, patch: unknown) => {
          updateCalls.push([workspaceId, phaseId, patch]);
          return makePhase();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Edit Foundations"]').trigger("click");
    await flushPromises();

    const descriptionInput = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    )!;
    expect(descriptionInput.value).toBe(
      "The full write-up, well past the preview.",
    );

    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Save");
    save!.click();
    await flushPromises();

    expect(updateCalls).toEqual([
      [
        "w1",
        "ph1",
        {
          title: "Foundations",
          description: "The full write-up, well past the preview.",
        },
      ],
    ]);
  });

  it("View opens the read dialog with the full description", async () => {
    const client = {
      phases: {
        list: async () => [makePhase()],
        get: async () => ({
          ...makePhase(),
          description: "The full write-up, well past the preview.",
        }),
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="View Foundations"]').trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("Phase 1");
    expect(document.body.textContent).toContain(
      "The full write-up, well past the preview.",
    );
  });

  it("invites the build plan when there is nothing yet", async () => {
    const client = {
      phases: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.text()).toContain("No phases yet");
  });
});
