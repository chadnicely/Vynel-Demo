import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import FeaturesSection from "./FeaturesSection.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

function makePhase(overrides: Record<string, unknown> = {}) {
  return {
    id: "ph1",
    userId: "u1",
    workspaceId: "w1",
    title: "Foundations",
    descriptionPreview: "Schema, auth.",
    orderIndex: 0,
    status: "open",
    sessionId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    userId: "u1",
    workspaceId: "w1",
    title: "Email sending",
    descriptionPreview: "Compose, queue, deliver.",
    phaseId: "ph1",
    status: "open",
    sessionId: null,
    completedAt: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function mountSection(client: VynelClient) {
  return mount(FeaturesSection, {
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

describe("FeaturesSection", () => {
  it("groups features under their phase in build order, with dangling and unlinked rows in Not placed", async () => {
    const client = {
      phases: {
        list: async () => [
          makePhase({ id: "ph2", title: "Polish", orderIndex: 1 }),
          makePhase(),
        ],
      },
      features: {
        list: async () => [
          makeFeature(),
          makeFeature({ id: "f2", title: "Onboarding tour", phaseId: "ph2" }),
          // Unlinked, and a loose ref whose phase was deleted — both land in
          // "Not placed" instead of vanishing.
          makeFeature({ id: "f3", title: "Dark mode", phaseId: null }),
          makeFeature({ id: "f4", title: "Ghost", phaseId: "ph-deleted" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(
      wrapper.findAll(".group-label").map((label) => label.text()),
    ).toEqual(["Foundations", "Polish", "Not placed"]);
    expect(wrapper.findAll(".row")).toHaveLength(4);
    expect(wrapper.text()).toContain("Dark mode");
    expect(wrapper.text()).toContain("Ghost");
  });

  it("cycles status in place with the feature noun", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      phases: { list: async () => [makePhase()] },
      features: {
        list: async () => [makeFeature()],
        update: async (
          workspaceId: string,
          featureId: string,
          patch: unknown,
        ) => {
          updateCalls.push([workspaceId, featureId, patch]);
          return makeFeature({ status: "in-progress" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Start this feature"]').trigger("click");
    await flushPromises();

    expect(updateCalls).toEqual([["w1", "f1", { status: "in-progress" }]]);
  });

  it("creates through the dialog, carrying the picked phase (or omitting it for Not placed)", async () => {
    const createCalls: unknown[] = [];
    const client = {
      phases: { list: async () => [makePhase()] },
      features: {
        list: async () => [],
        create: async (workspaceId: string, body: unknown) => {
          createCalls.push([workspaceId, body]);
          return makeFeature();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('button[type="button"]').trigger("click"); // "New feature"
    await flushPromises();

    const titleInput = document.body.querySelector<HTMLInputElement>(
      '[role="dialog"] input[type="text"]',
    )!;
    titleInput.value = "Email sending";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    const descriptionInput = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    )!;
    descriptionInput.value = "Compose, queue, deliver.";
    descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));
    const phasePicker = document.body.querySelector<HTMLSelectElement>(
      '[role="dialog"] select',
    )!;
    phasePicker.value = "ph1";
    phasePicker.dispatchEvent(new Event("change", { bubbles: true }));
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
          title: "Email sending",
          description: "Compose, queue, deliver.",
          phaseId: "ph1",
        },
      ],
    ]);
  });

  it("Edit fetches the full description and can UNLINK the phase (phaseId null on the wire)", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      phases: { list: async () => [makePhase()] },
      features: {
        list: async () => [makeFeature()],
        get: async () => ({
          ...makeFeature(),
          description: "The full feature write-up.",
        }),
        update: async (
          workspaceId: string,
          featureId: string,
          patch: unknown,
        ) => {
          updateCalls.push([workspaceId, featureId, patch]);
          return makeFeature();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Edit Email sending"]').trigger("click");
    await flushPromises();

    const descriptionInput = document.body.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    )!;
    expect(descriptionInput.value).toBe("The full feature write-up.");

    const phasePicker = document.body.querySelector<HTMLSelectElement>(
      '[role="dialog"] select',
    )!;
    expect(phasePicker.value).toBe("ph1");
    phasePicker.value = "";
    phasePicker.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    const save = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Save");
    save!.click();
    await flushPromises();

    expect(updateCalls).toEqual([
      [
        "w1",
        "f1",
        {
          title: "Email sending",
          description: "The full feature write-up.",
          phaseId: null,
        },
      ],
    ]);
  });

  it("invites building when there is nothing yet", async () => {
    const client = {
      phases: { list: async () => [] },
      features: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.text()).toContain("No features yet");
  });
});
