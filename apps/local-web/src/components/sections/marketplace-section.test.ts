// The marketplace storefront. Behavior under guard (migrated from the panel's
// inline block): the display-only Pro badge — the rendered combination
// `minimumTier === 'pro' && !isPro` (the composable test alone can't catch a
// template that drops either half) — the kind chips, the install flow, and
// the irreversible-remove two-step. Search + filters compose with AND, and
// "no results" reads differently from "empty catalog". The section is
// scope-aware: the workspace surface drives `marketplace.*`, the GLOBAL
// surface drives the user-scoped `marketplaceUser.*` endpoints.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WorkspaceSectionPanel from "../workspace/WorkspaceSectionPanel.vue";
import MarketplaceSection from "./MarketplaceSection.vue";

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: "email-drafter",
    kind: "skill",
    skillId: "email-drafter",
    publisherTier: "verified",
    publisherName: "Vynel",
    publisherUrl: null,
    sourceUrl: null,
    displayName: "Email Drafter",
    oneLineDescription: "Draft emails.",
    category: "email",
    iconName: "mail",
    version: "1.0.0",
    releasedAt: "2026-07-01T00:00:00.000Z",
    recommendedScope: "workspace",
    scope: "both",
    isOfficial: false,
    installStatus: { kind: "not-installed" },
    ...overrides,
  };
}

// A pro-only item and a basic item side by side — only the pro item may carry
// the badge, so the count also proves the `minimumTier === 'pro'` half.
const items: MarketplaceItem[] = [
  makeItem({
    itemId: "pro-skill",
    displayName: "Pro Skill",
    minimumTier: "pro",
  }),
  makeItem({
    itemId: "free-skill",
    displayName: "Free Skill",
    minimumTier: "basic",
  }),
];

const installResult = {
  kind: "skill",
  installedSkillId: "sk1",
  itemId: "free-skill",
  scope: "workspace",
  source: "marketplace",
  version: "1.0.0",
};

function makeClient(
  session: Record<string, unknown>,
  options: {
    items?: MarketplaceItem[];
    install?: (...args: unknown[]) => Promise<unknown>;
    update?: (...args: unknown[]) => Promise<unknown>;
    uninstall?: (...args: unknown[]) => Promise<unknown>;
    userInstall?: (...args: unknown[]) => Promise<unknown>;
    userUpdate?: (...args: unknown[]) => Promise<unknown>;
    userUninstall?: (...args: unknown[]) => Promise<unknown>;
  } = {},
) {
  const listItems = options.items ?? items;
  const install = options.install ?? (async () => installResult);
  const update = options.update ?? (async () => installResult);
  const uninstall =
    options.uninstall ??
    (async () => ({ kind: "skill", installedSkillId: "sk1", itemId: "owned" }));
  return {
    hub: { getSession: async () => session },
    marketplace: { listItems: async () => listItems, install, update, uninstall },
    // The GLOBAL surface's endpoints — the same shelf, user scope.
    marketplaceUser: {
      listItems: async () => listItems,
      install: options.userInstall ?? (async () => installResult),
      update: options.userUpdate ?? (async () => installResult),
      uninstall:
        options.userUninstall ??
        (async () => ({
          kind: "skill",
          installedSkillId: "sk1",
          itemId: "owned",
        })),
    },
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
  session: Record<string, unknown>,
  options: Parameters<typeof makeClient>[1] = {},
  scope: { kind: "global" } | { kind: "workspace"; workspaceId: string } = {
    kind: "workspace",
    workspaceId: "w1",
  },
) {
  return mount(MarketplaceSection, {
    props: { scope },
    ...mountOptions(makeClient(session, options)),
  });
}

const installedItem = () =>
  makeItem({
    itemId: "owned",
    displayName: "Owned",
    installStatus: {
      kind: "installed",
      scope: "workspace",
      installedId: "sk1",
      versionInstalled: "1.0.0",
    },
  });

describe("MarketplaceSection — Pro badge", () => {
  it("shows Pro on a pro-only item when the user isn't proven Pro (signed-out)", async () => {
    const wrapper = mountSection({ kind: "signed-out" });
    await flushPromises();

    const badges = wrapper.findAll(".scope-chip.is-pro");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.text()).toBe("Pro");
    wrapper.unmount();
  });

  it("hides Pro once the user is on Pro (they can install it)", async () => {
    const wrapper = mountSection({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-10T09:00:00.000Z",
      tier: "pro",
      features: ["channels", "marketplace"],
    });
    await flushPromises();

    expect(wrapper.findAll(".scope-chip.is-pro")).toHaveLength(0);
    wrapper.unmount();
  });
});

describe("MarketplaceSection — kind chip", () => {
  it("labels every card with its kind (Skill / Agent)", async () => {
    const wrapper = mountSection(
      { kind: "signed-out" },
      {
        items: [
          makeItem({ itemId: "email-drafter", displayName: "Email Drafter" }),
          makeItem({
            itemId: "focus-writer",
            kind: "agent",
            skillId: "focus-writer",
            displayName: "Focus Writer",
          }),
          makeItem({
            itemId: "document-skills",
            kind: "plugin",
            skillId: "document-skills",
            displayName: "Documents Pack",
            pluginKey: "document-skills@anthropic-agent-skills",
          }),
        ],
      },
    );
    await flushPromises();

    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("Skill");
    expect(chips).toContain("Agent");
    expect(chips).toContain("Plugin");
    wrapper.unmount();
  });
});

describe("MarketplaceSection — install", () => {
  it("installs the clicked item at the workspace scope", async () => {
    const install = vi.fn(async () => installResult);
    const wrapper = mountSection(
      { kind: "signed-out" },
      {
        items: [makeItem({ itemId: "free-skill", displayName: "Free Skill" })],
        install,
      },
    );
    await flushPromises();

    await wrapper.get("button.pill").trigger("click");
    await flushPromises();

    expect(install).toHaveBeenCalledWith("w1", {
      itemId: "free-skill",
      scope: "workspace",
    });
    wrapper.unmount();
  });

  it("shows an installed item as disabled, not a live Get button", async () => {
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: [installedItem()] },
    );
    await flushPromises();

    const button = wrapper.get("button.pill");
    expect(button.text()).toBe("Installed");
    expect(button.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});

describe("MarketplaceSection — uninstall", () => {
  it("removes only on the second, armed click (one click never uninstalls)", async () => {
    const uninstall = vi.fn(async () => ({
      kind: "skill",
      installedSkillId: "sk1",
      itemId: "owned",
    }));
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: [installedItem()], uninstall },
    );
    await flushPromises();

    // First click only arms — the control flips to "Sure?" and nothing fires.
    const armButton = wrapper.get('[aria-label="Remove Owned"]');
    expect(armButton.text()).toBe("Remove");
    await armButton.trigger("click");
    await flushPromises();
    expect(uninstall).not.toHaveBeenCalled();

    const confirmButton = wrapper.get('[aria-label="Confirm remove Owned"]');
    expect(confirmButton.text()).toBe("Sure?");
    await confirmButton.trigger("click");
    await flushPromises();

    expect(uninstall).toHaveBeenCalledWith("w1", { itemId: "owned" });
    wrapper.unmount();
  });

  it("disarms the remove confirm on blur instead of firing", async () => {
    const uninstall = vi.fn(async () => ({
      kind: "skill",
      installedSkillId: "sk1",
      itemId: "owned",
    }));
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: [installedItem()], uninstall },
    );
    await flushPromises();

    await wrapper.get('[aria-label="Remove Owned"]').trigger("click");
    await wrapper.get('[aria-label="Confirm remove Owned"]').trigger("blur");
    await flushPromises();

    expect(uninstall).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Remove Owned"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers no Remove control on a not-installed item", async () => {
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: [makeItem({ itemId: "free-skill", displayName: "Free" })] },
    );
    await flushPromises();

    expect(wrapper.find(".row-action").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("MarketplaceSection — provenance", () => {
  it("badges Anthropic items 'By Anthropic' and renders the credit line with links", async () => {
    const wrapper = mountSection(
      { kind: "signed-out" },
      {
        items: [
          makeItem({
            itemId: "canvas-design",
            displayName: "Canvas Design",
            publisherTier: "anthropic-official",
            publisherName: "Anthropic",
            publisherUrl: "https://www.anthropic.com",
            sourceUrl: "https://github.com/anthropics/skills/tree/b29e7cf/skills/canvas-design",
            isOfficial: true,
          }),
          makeItem({ itemId: "email-drafter", isOfficial: true }),
        ],
      },
    );
    await flushPromises();

    const badges = wrapper.findAll(".scope-chip.is-gold").map((b) => b.text());
    expect(badges).toContain("By Anthropic");
    expect(badges).toContain("Official");

    const credits = wrapper.findAll(".credit-line");
    expect(credits.some((c) => c.text().includes("By Anthropic"))).toBe(true);
    const sourceLink = credits
      .flatMap((c) => c.findAll("a"))
      .find((a) => a.text() === "Source");
    expect(sourceLink?.attributes("href")).toBe(
      "https://github.com/anthropics/skills/tree/b29e7cf/skills/canvas-design",
    );
    wrapper.unmount();
  });
});

// Update appears ONLY on an installed skill whose catalog version moved past
// the installed one — an up-to-date skill and an agent (versionInstalled
// null) must never offer it, or the card promises an update the daemon
// rejects.
describe("MarketplaceSection — update flow", () => {
  const updatableShelf: MarketplaceItem[] = [
    makeItem({
      itemId: "canvas-design",
      displayName: "Canvas Design",
      version: "1.1.0",
      installStatus: {
        kind: "installed",
        scope: "workspace",
        installedId: "sk-canvas",
        versionInstalled: "1.0.0",
      },
    }),
    makeItem({
      itemId: "owned",
      displayName: "Owned",
      installStatus: {
        kind: "installed",
        scope: "workspace",
        installedId: "sk1",
        versionInstalled: "1.0.0",
      },
    }),
    makeItem({
      itemId: "focus-writer",
      kind: "agent",
      skillId: "focus-writer",
      displayName: "Focus Writer",
      version: "2.0.0",
      installStatus: {
        kind: "installed",
        scope: "workspace",
        installedId: "ag1",
        versionInstalled: null,
      },
    }),
  ];

  it("shows Update only where the catalog is ahead, and drives the workspace endpoint", async () => {
    const update = vi.fn(async () => installResult);
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: updatableShelf, update },
    );
    await flushPromises();

    const updateButtons = wrapper.findAll(".is-update");
    expect(updateButtons).toHaveLength(1);

    await updateButtons[0]!.trigger("click");
    await flushPromises();
    expect(update).toHaveBeenCalledWith("w1", { itemId: "canvas-design" });
    wrapper.unmount();
  });

  it("drives the user-scoped endpoint on the GLOBAL surface", async () => {
    const userUpdate = vi.fn(async () => installResult);
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: updatableShelf, userUpdate },
      { kind: "global" },
    );
    await flushPromises();

    await wrapper.get(".is-update").trigger("click");
    await flushPromises();
    expect(userUpdate).toHaveBeenCalledWith({ itemId: "canvas-design" });
    wrapper.unmount();
  });
});

// Distinct fixtures for filtering: names, descriptions, and categories never
// overlap by accident, so each test proves exactly one matching field.
const shelf: MarketplaceItem[] = [
  makeItem({
    itemId: "email-drafter",
    displayName: "Email Drafter",
    oneLineDescription: "Turn bullet points into polished drafts.",
    category: "email",
  }),
  makeItem({
    itemId: "focus-writer",
    kind: "agent",
    skillId: "focus-writer",
    displayName: "Focus Writer",
    oneLineDescription: "A persona for deep-focus writing.",
    category: "notes",
  }),
  makeItem({
    itemId: "owned",
    displayName: "Owned",
    oneLineDescription: "Already part of this room.",
    category: "files",
    installStatus: {
      kind: "installed",
      scope: "workspace",
      installedId: "sk1",
      versionInstalled: "1.0.0",
    },
  }),
];

function cardTitles(wrapper: ReturnType<typeof mountSection>): string[] {
  return wrapper.findAll(".card-title").map((title) => title.text());
}

function filterChip(wrapper: ReturnType<typeof mountSection>, label: string) {
  const chip = wrapper
    .findAll("button.filter-chip")
    .find((button) => button.text() === label);
  if (!chip) throw new Error(`No filter chip labeled "${label}"`);
  return chip;
}

describe("MarketplaceSection — search + filters", () => {
  it("narrows by search across name, description, and category (case-insensitive)", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: shelf });
    await flushPromises();
    const searchInput = wrapper.get('input[type="search"]');

    await searchInput.setValue("POLISHED"); // description, wrong case
    expect(cardTitles(wrapper)).toEqual(["Email Drafter"]);

    await searchInput.setValue("notes"); // category
    expect(cardTitles(wrapper)).toEqual(["Focus Writer"]);

    await searchInput.setValue("owned"); // name
    expect(cardTitles(wrapper)).toEqual(["Owned"]);
    wrapper.unmount();
  });

  it("filters by kind via the Skills / Agents chips, and All restores", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: shelf });
    await flushPromises();

    await filterChip(wrapper, "Agents").trigger("click");
    expect(cardTitles(wrapper)).toEqual(["Focus Writer"]);

    await filterChip(wrapper, "Skills").trigger("click");
    expect(cardTitles(wrapper)).toEqual(["Email Drafter", "Owned"]);

    await filterChip(wrapper, "All").trigger("click");
    expect(cardTitles(wrapper)).toHaveLength(3);
    wrapper.unmount();
  });

  it("shows only installed items while the Installed toggle is on", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: shelf });
    await flushPromises();

    const installedToggle = filterChip(wrapper, "Installed");
    await installedToggle.trigger("click");
    expect(cardTitles(wrapper)).toEqual(["Owned"]);

    await installedToggle.trigger("click");
    expect(cardTitles(wrapper)).toHaveLength(3);
    wrapper.unmount();
  });

  it("composes filters with AND (kind + installed + search)", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: shelf });
    await flushPromises();

    await filterChip(wrapper, "Skills").trigger("click");
    await filterChip(wrapper, "Installed").trigger("click");
    expect(cardTitles(wrapper)).toEqual(["Owned"]);

    // The search matches a non-installed skill — the AND leaves nothing.
    await wrapper.get('input[type="search"]').setValue("polished");
    expect(cardTitles(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain("Nothing matches");
    wrapper.unmount();
  });

  it("tells no-results apart from an empty catalog, and clears back", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: shelf });
    await flushPromises();

    await wrapper.get('input[type="search"]').setValue("zzz-no-such-item");
    expect(wrapper.text()).toContain("Nothing matches");
    expect(wrapper.text()).toContain("clear the filters");
    expect(wrapper.text()).not.toContain("The shelf is empty");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Clear search and filters")!
      .trigger("click");
    expect(cardTitles(wrapper)).toHaveLength(3);
    wrapper.unmount();
  });

  it("reads an empty catalog as the shelf being empty — no search, no chips", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, { items: [] });
    await flushPromises();

    expect(wrapper.text()).toContain("The shelf is empty");
    expect(wrapper.find('input[type="search"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Nothing matches");
    wrapper.unmount();
  });
});

describe("MarketplaceSection — global surface", () => {
  it("renders the user-level shelf with the global header copy", async () => {
    const wrapper = mountSection({ kind: "signed-out" }, {}, { kind: "global" });
    await flushPromises();

    expect(wrapper.text()).toContain("ready to add for you");
    expect(wrapper.findAll(".card-title").length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("keeps the workspace header copy on the workspace surface", async () => {
    const wrapper = mountSection({ kind: "signed-out" });
    await flushPromises();

    expect(wrapper.text()).toContain("ready to add to this workspace");
    wrapper.unmount();
  });

  it("installs via the USER-scoped endpoint (no workspace, no scope in the body)", async () => {
    const userInstall = vi.fn(async () => installResult);
    const install = vi.fn(async () => installResult);
    const wrapper = mountSection(
      { kind: "signed-out" },
      {
        items: [makeItem({ itemId: "free-skill", displayName: "Free Skill" })],
        install,
        userInstall,
      },
      { kind: "global" },
    );
    await flushPromises();

    await wrapper.get("button.pill").trigger("click");
    await flushPromises();

    expect(userInstall).toHaveBeenCalledWith({ itemId: "free-skill" });
    expect(install).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("removes via the USER-scoped endpoint after the armed confirm", async () => {
    const userUninstall = vi.fn(async () => ({
      kind: "skill",
      installedSkillId: "sk1",
      itemId: "owned",
    }));
    const uninstall = vi.fn(async () => ({}));
    const wrapper = mountSection(
      { kind: "signed-out" },
      { items: [installedItem()], uninstall, userUninstall },
      { kind: "global" },
    );
    await flushPromises();

    await wrapper.get('[aria-label="Remove Owned"]').trigger("click");
    await wrapper.get('[aria-label="Confirm remove Owned"]').trigger("click");
    await flushPromises();

    expect(userUninstall).toHaveBeenCalledWith({ itemId: "owned" });
    expect(uninstall).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — marketplace delegation", () => {
  it("hosts MarketplaceSection for the marketplace drawer item", async () => {
    const wrapper = mount(WorkspaceSectionPanel, {
      props: { section: "marketplace" as const, workspaceId: "w1" },
      ...mountOptions(makeClient({ kind: "signed-out" })),
    });
    await flushPromises();

    expect(wrapper.findComponent(MarketplaceSection).exists()).toBe(true);
    wrapper.unmount();
  });
});
