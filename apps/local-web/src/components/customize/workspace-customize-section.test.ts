import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import WorkspaceCustomizeSection from "./WorkspaceCustomizeSection.vue";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    name: "vynel",
    managerName: "Sarah",
    kind: "project",
    path: "E:/KLONE/Workspace/vynel",
    isArchived: false,
    continueEnabled: true,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    lastAccessedAt: null,
    ...overrides,
  };
}

function mountSection(client: VynelClient) {
  return mount(WorkspaceCustomizeSection, {
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
  });
}

describe("WorkspaceCustomizeSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("prefills the persona card from the workspace row", async () => {
    const client = {
      workspaces: { list: async () => [makeWorkspace()] },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    const inputs = wrapper.findAll(".customize-section input[type='text']");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("vynel");
    expect((inputs[1]!.element as HTMLInputElement).value).toBe("Sarah");
    // The menu editor lists every catalog section.
    // test: correct expectation — the catalog grew: 'tool-policy' joined the
    // toolkit group (the admin tool matrix, 2026-08-14).
    expect(wrapper.findAll(".entry-row").length).toBe(17);
  });

  it("autosaves persona edits through workspaces.update on blur (no Save button)", async () => {
    const updateCalls: unknown[] = [];
    const client = {
      workspaces: {
        list: async () => [makeWorkspace()],
        update: async (workspaceId: string, input: unknown) => {
          updateCalls.push([workspaceId, input]);
          return makeWorkspace({ managerName: "Maya" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.find(".save-button").exists()).toBe(false);
    const persona = wrapper.findAll(".customize-section input[type='text']")[1]!;
    await persona.setValue("Maya");
    await persona.trigger("blur");
    await flushPromises();

    expect(updateCalls).toEqual([["w1", { managerName: "Maya" }]]);
    expect(wrapper.get(".save-status").text()).toBe("Saved");
  });

  it("hiding a section and adding a group edit the live store", async () => {
    const client = {
      workspaces: { list: async () => [makeWorkspace()] },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Hide Journal"]').trigger("click");
    expect(wrapper.find('[aria-label="Show Journal"]').exists()).toBe(true);

    await wrapper.get('[aria-label="New group name"]').setValue("Ops");
    await wrapper.get(".menu-editor form").trigger("submit");
    const groupSelect = wrapper.get('[aria-label="Group for Agents"]');
    expect(groupSelect.text()).toContain("Ops");

    // Both edits persisted → the reset affordance appears.
    expect(wrapper.find(".reset-button").exists()).toBe(true);
  });
});
