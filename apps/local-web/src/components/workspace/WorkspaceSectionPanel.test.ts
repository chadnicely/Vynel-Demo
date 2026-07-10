// The marketplace "Pro" badge: display-only, shown on a pro-only item while
// the user isn't proven Pro (the real install gate is server-side). The badge
// is the deliverable — mount the panel and assert the rendered combination
// `minimumTier === 'pro' && !isPro`, since the composable test alone can't
// catch a template that drops either half.

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WorkspaceSectionPanel from "./WorkspaceSectionPanel.vue";

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: "email-drafter",
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

function mountPanel(session: Record<string, unknown>) {
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
          marketplace: { listItems: async () => items },
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
