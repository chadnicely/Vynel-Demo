// The marketplace "Pro" badge: display-only, shown on a pro-only item while
// the user isn't proven Pro (the real install gate is server-side). The badge
// is the deliverable — mount the panel and assert the rendered combination
// `minimumTier === 'pro' && !isPro`, since the composable test alone can't
// catch a template that drops either half.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WorkspaceSectionPanel from "./WorkspaceSectionPanel.vue";

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: "email-drafter",
    kind: "skill",
    skillId: "email-drafter",
    publisherTier: "verified",
    publisherName: "Vynel",
    publisherUrl: null,
    displayName: "Email Drafter",
    oneLineDescription: "Draft emails.",
    category: "email",
    iconName: "Mail",
    version: "1.0.0",
    releasedAt: "2026-07-01T00:00:00.000Z",
    recommendedScope: "workspace",
    isOfficial: false,
    installStatus: { kind: "not-installed" },
    ...overrides,
  };
}

// A pro-only item and a basic item side by side — only the pro item may carry
// the badge, so the count also proves the `minimumTier === 'pro'` half.
const items: MarketplaceItem[] = [
  makeItem({ itemId: "pro-skill", displayName: "Pro Skill", minimumTier: "pro" }),
  makeItem({ itemId: "free-skill", displayName: "Free Skill", minimumTier: "basic" }),
];

const installResult = {
  kind: "skill",
  installedSkillId: "sk1",
  itemId: "free-skill",
  scope: "workspace",
  source: "marketplace",
  version: "1.0.0",
};

function mountPanel(
  session: Record<string, unknown>,
  options: {
    items?: MarketplaceItem[];
    install?: (...args: unknown[]) => Promise<unknown>;
  } = {},
) {
  const listItems = options.items ?? items;
  const install = options.install ?? (async () => installResult);
  return mount(WorkspaceSectionPanel, {
    props: { section: "marketplace", workspaceId: "w1" },
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
      provide: {
        [vynelClientKey as symbol]: {
          hub: { getSession: async () => session },
          marketplace: { listItems: async () => listItems, install },
        },
      },
    },
  });
}

describe("WorkspaceSectionPanel — marketplace Pro badge", () => {
  it("shows Pro on a pro-only item when the user isn't proven Pro (signed-out)", async () => {
    const wrapper = mountPanel({ kind: "signed-out" });
    await flushPromises();

    const badges = wrapper.findAll(".scope-chip.is-pro");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.text()).toBe("Pro");
    wrapper.unmount();
  });

  it("hides Pro once the user is on Pro (they can install it)", async () => {
    const wrapper = mountPanel({
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

describe("WorkspaceSectionPanel — marketplace kind chip", () => {
  it("labels every row with its kind (Skill / Agent)", async () => {
    const wrapper = mountPanel(
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
        ],
      },
    );
    await flushPromises();

    const chips = wrapper.findAll(".scope-chip").map((chip) => chip.text());
    expect(chips).toContain("Skill");
    expect(chips).toContain("Agent");
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — marketplace install", () => {
  it("installs the clicked item at the workspace scope", async () => {
    const install = vi.fn(async () => installResult);
    const wrapper = mountPanel(
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
    const wrapper = mountPanel(
      { kind: "signed-out" },
      {
        items: [
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
        ],
      },
    );
    await flushPromises();

    const button = wrapper.get("button.pill");
    expect(button.text()).toBe("Installed");
    expect(button.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
