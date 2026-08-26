// The other half of the owned/resolved split (2026-08-03). The MENUS ask what
// a scope owns so their lists mirror disk; the composer's "@" and "/" pickers
// must ask what a session running HERE can actually reach — user ∪ workspace —
// because `settingSources: ['user','project','local']` really does load both.
// Offering only the workspace's own rows would hide agents and commands that
// demonstrably work, so this pins the composer to the resolved routes.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import AppComposer from "./AppComposer.vue";
import type { SectionScope } from "../sections/section-scope.js";
import type { VynelClient } from "@vynel/sdk";

function makeSpies() {
  return {
    agentsList: vi.fn(async () => []),
    agentsResolved: vi.fn(async () => []),
    skillsList: vi.fn(async () => []),
    skillsResolved: vi.fn(async () => []),
    commandsList: vi.fn(async () => ({ commands: [] })),
    commandsResolved: vi.fn(async () => ({ commands: [] })),
  };
}

function makeClient(spies: ReturnType<typeof makeSpies>): VynelClient {
  return {
    agents: { list: spies.agentsList, listResolved: spies.agentsResolved },
    skills: {
      listInstalled: spies.skillsList,
      listInstalledResolved: spies.skillsResolved,
    },
    commands: { list: spies.commandsList, listResolved: spies.commandsResolved },
    workspaces: { list: async () => [] },
    models: { list: async () => ({ models: [] }) },
  } as unknown as VynelClient;
}

function mountComposer(client: VynelClient, scope: SectionScope) {
  return mount(AppComposer, {
    props: { scope },
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
        ] as unknown as Plugin,
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
}

describe("AppComposer — mention rosters", () => {
  it("reads the RESOLVED routes in a workspace, never the owned ones", async () => {
    const spies = makeSpies();
    const wrapper = mountComposer(makeClient(spies), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    expect(spies.agentsResolved).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(spies.skillsResolved).toHaveBeenCalledWith("w1");
    expect(spies.commandsResolved).toHaveBeenCalledWith({ workspaceId: "w1" });

    // The menu's reads must stay out of the picker — they are a shorter list.
    expect(spies.agentsList).not.toHaveBeenCalled();
    expect(spies.skillsList).not.toHaveBeenCalled();
    expect(spies.commandsList).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
