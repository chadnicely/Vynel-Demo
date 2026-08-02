// The Rules + Commands views on both surfaces. Guards: the surface split
// (workspace route vs user route), the "Managed by Vynel" provenance chip on
// marker-carrying rules only, the read-only view dialog, and the slash-name
// presentation of commands.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import CommandsSection from "./CommandsSection.vue";
import RulesSection from "./RulesSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "git-hygiene",
    fileName: "git-hygiene.md",
    title: "Git hygiene",
    content: "# Git hygiene\n\nSmall commits.",
    scope: "user",
    marketplace: { ruleId: "git-hygiene", version: "2.1.0" },
    ...overrides,
  };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandName: "git:commit",
    relativePath: "git/commit.md",
    description: "Commit the current work",
    argumentHint: "[message]",
    bodyPreview: "Commit the work.",
    scope: "user",
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    rules: { list: async () => ({ rules: [makeRule()] }) },
    rulesUser: { list: async () => ({ rules: [makeRule()] }) },
    commands: { list: async () => ({ commands: [makeCommand()] }) },
    commandsUser: { list: async () => ({ commands: [makeCommand()] }) },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
    ...options,
  };
}

function mountOptions(client: ReturnType<typeof makeClient>) {
  const plugins: [Plugin, ...unknown[]][] = [
    [
      VueQueryPlugin,
      {
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
    ],
  ];
  return {
    global: {
      plugins,
      provide: { [vynelClientKey as symbol]: client },
    },
  };
}

describe("RulesSection", () => {
  it("marks a marketplace rule Managed by Vynel; a hand-written one wears no chip", async () => {
    const client = makeClient({
      rulesUser: {
        list: async () => ({
          rules: [
            makeRule(),
            makeRule({
              ruleId: "my-style",
              fileName: "my-style.md",
              title: "My style",
              marketplace: null,
            }),
          ],
        }),
      },
    });
    const wrapper = mount(RulesSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Managed by Vynel");
    expect(rows[0]!.text()).toContain("v2.1.0");
    expect(rows[1]!.text()).not.toContain("Managed by Vynel");
    wrapper.unmount();
  });

  it("asks the workspace route on the workspace surface and chips row scopes", async () => {
    const list = vi.fn(async () => ({
      rules: [makeRule(), makeRule({ ruleId: "room", fileName: "room.md", title: "Room", scope: "workspace", marketplace: null })],
    }));
    const wrapper = mount(RulesSection, {
      props: { scope: { kind: "workspace", workspaceId: "w1" } as SectionScope },
      ...mountOptions(makeClient({ rules: { list } })),
    });
    await flushPromises();

    expect(list).toHaveBeenCalledWith("w1");
    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("Global");
    expect(chips).toContain("vynel");
    wrapper.unmount();
  });

  it("opens a rule read-only in the dialog", async () => {
    const wrapper = mount(RulesSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(makeClient()),
    });
    await flushPromises();

    await wrapper.get(".row-open").trigger("click");
    await flushPromises();
    const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1]!;
    expect(dialog.textContent).toContain("Small commits.");
    wrapper.unmount();
  });
});

describe("CommandsSection", () => {
  it("renders slash names with argument hints on the global surface", async () => {
    const listUser = vi.fn(async () => ({ commands: [makeCommand()] }));
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(makeClient({ commandsUser: { list: listUser } })),
    });
    await flushPromises();

    expect(listUser).toHaveBeenCalledWith();
    expect(wrapper.text()).toContain("/git:commit");
    expect(wrapper.text()).toContain("[message]");
    expect(wrapper.text()).toContain("Commit the current work");
    wrapper.unmount();
  });

  it("asks the workspace route on the workspace surface", async () => {
    const list = vi.fn(async () => ({
      commands: [makeCommand({ commandName: "deploy", scope: "workspace" })],
    }));
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "workspace", workspaceId: "w1" } as SectionScope },
      ...mountOptions(makeClient({ commands: { list } })),
    });
    await flushPromises();

    expect(list).toHaveBeenCalledWith("w1");
    expect(wrapper.text()).toContain("/deploy");
    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("vynel");
    wrapper.unmount();
  });

  it("shows the empty state when no commands exist", async () => {
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(
        makeClient({ commandsUser: { list: async () => ({ commands: [] }) } }),
      ),
    });
    await flushPromises();

    expect(wrapper.text()).toContain("No commands yet");
    wrapper.unmount();
  });
});
