// The Skills shelf on both surfaces (extracted from the drawer's last inline
// list). Guards the surface split — the workspace drawer asks the workspace
// route (user ∪ room fusion), the global menu the user-scope route — and the
// panel's delegation to the extracted component.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WorkspaceSectionPanel from "../workspace/WorkspaceSectionPanel.vue";
import SkillsSection from "./SkillsSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "is1",
    skillId: "email-drafter",
    scope: "user",
    workspaceId: null,
    installedFromSource: "verified-catalog",
    versionInstalled: "1.0.0",
    installHealth: "healthy",
    installHealthMessage: null,
    installedAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    definition: {
      skillId: "email-drafter",
      displayName: "Email Drafter",
      oneLineDescription: "Drafts emails in your voice.",
      category: "email",
      iconName: "mail",
      version: "1.0.0",
      recommendedScope: "user",
      isSystemInstalled: false,
      settingsSchema: [],
    },
    resolvedSettings: {},
    ...overrides,
  };
}

function makeClient(
  options: {
    listInstalled?: (...args: unknown[]) => Promise<unknown>;
    listInstalledUser?: (...args: unknown[]) => Promise<unknown>;
  } = {},
) {
  return {
    skills: {
      listInstalled: options.listInstalled ?? (async () => [makeSkill()]),
    },
    skillsUser: {
      listInstalled: options.listInstalledUser ?? (async () => [makeSkill()]),
    },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
    hub: { getSession: async () => ({ kind: "signed-out" }) },
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

function mountSection(
  client: ReturnType<typeof makeClient>,
  scope: SectionScope,
) {
  return mount(SkillsSection, { props: { scope }, ...mountOptions(client) });
}

describe("SkillsSection — surfaces", () => {
  it("asks the workspace route (fusion) on the workspace surface", async () => {
    const listInstalled = vi.fn(async () => [
      makeSkill({ scope: "workspace", workspaceId: "w1" }),
    ]);
    const wrapper = mountSection(makeClient({ listInstalled }), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    expect(listInstalled).toHaveBeenCalledWith("w1");
    expect(wrapper.text()).toContain("Email Drafter");
    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("vynel");
    wrapper.unmount();
  });

  it("asks the user-scope route on the global surface", async () => {
    const listInstalledUser = vi.fn(async () => [makeSkill()]);
    const wrapper = mountSection(makeClient({ listInstalledUser }), {
      kind: "global",
    });
    await flushPromises();

    expect(listInstalledUser).toHaveBeenCalledWith();
    expect(wrapper.text()).toContain("Email Drafter");
    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("Global");
    wrapper.unmount();
  });

  it("invites a marketplace visit when nothing is installed", async () => {
    const wrapper = mountSection(
      makeClient({ listInstalledUser: async () => [] }),
      { kind: "global" },
    );
    await flushPromises();

    expect(wrapper.text()).toContain("No skills yet");
    expect(wrapper.text()).toContain("Marketplace");
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — skills delegation", () => {
  it("hosts SkillsSection for the skills drawer item (inline list retired)", async () => {
    const wrapper = mount(WorkspaceSectionPanel, {
      props: { section: "skills" as const, workspaceId: "w1" },
      ...mountOptions(makeClient()),
    });
    await flushPromises();

    expect(wrapper.findComponent(SkillsSection).exists()).toBe(true);
    expect(wrapper.text()).toContain("Email Drafter");
    wrapper.unmount();
  });
});
