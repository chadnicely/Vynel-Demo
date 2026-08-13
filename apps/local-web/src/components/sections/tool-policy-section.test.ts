// The Tool Policy matrix. Guards the grouping by server with short display
// names (full key on the title attr), the customized dot, the reset routed
// with the FULL tool name, the workspace-only capabilities panel (the first
// UI over /workspaces/:id/capabilities), and the tier-lock greying.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import ToolPolicySection from "./ToolPolicySection.vue";
import type { SectionScope } from "./section-scope.js";

function makeOverriddenTool(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "mcp__vynel__memory_save",
    serverName: "vynel",
    enabled: true,
    surfaces: ["global-interactive", "workspace-interactive"],
    cardClass: "ask",
    featureKey: "memory",
    capabilityId: "memory",
    hasOverride: true,
    ...overrides,
  };
}

function makeDefaultTool(overrides: Record<string, unknown> = {}) {
  return {
    toolName: "mcp__desktop__screenshot",
    serverName: "desktop",
    enabled: true,
    surfaces: ["workspace-interactive"],
    cardClass: "never",
    hasOverride: false,
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    toolPolicies: {
      list: async () => ({
        tools: [makeOverriddenTool(), makeDefaultTool()],
      }),
      save: async () => makeOverriddenTool(),
      // The real DELETE answers with the post-reset row (declared defaults).
      reset: async () => makeOverriddenTool({ hasOverride: false }),
    },
    capabilities: {
      list: async () => ({
        capabilities: [
          {
            id: "memory",
            displayName: "Memory",
            description: "Remembers facts about you and your work.",
            scope: "workspace",
            isFirstParty: true,
            isEnabled: true,
          },
        ],
      }),
      setEnabled: async () => undefined,
    },
    hub: {
      getSession: async () => ({ kind: "not-configured" }),
    },
    ...options,
  };
}

function mountSection(
  client: ReturnType<typeof makeClient>,
  scope: SectionScope,
) {
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
  return mount(ToolPolicySection, {
    props: { scope },
    global: {
      plugins,
      provide: { [vynelClientKey as symbol]: client },
    },
  });
}

describe("ToolPolicySection — the matrix", () => {
  it("groups by server, shows short names with the full key on the title attr", async () => {
    const wrapper = mountSection(makeClient(), { kind: "global" });
    await flushPromises();

    const groupToggles = wrapper.findAll(".group-toggle").map((b) => b.text());
    expect(groupToggles.some((text) => text.includes("vynel"))).toBe(true);
    expect(groupToggles.some((text) => text.includes("desktop"))).toBe(true);

    const names = wrapper.findAll(".tool-name");
    expect(names.map((n) => n.text())).toEqual(["memory_save", "screenshot"]);
    expect(names[0]!.attributes("title")).toBe("mcp__vynel__memory_save");
    wrapper.unmount();
  });

  it("marks only customized rows with the dot and offers Reset only there", async () => {
    const wrapper = mountSection(makeClient(), { kind: "global" });
    await flushPromises();

    expect(wrapper.findAll(".override-dot")).toHaveLength(1);
    expect(wrapper.findAll(".reset-button")).toHaveLength(1);
    wrapper.unmount();
  });

  it("collapses a server group on its header toggle", async () => {
    const wrapper = mountSection(makeClient(), { kind: "global" });
    await flushPromises();

    await wrapper.findAll(".group-toggle")[0]!.trigger("click");
    expect(wrapper.findAll(".tool-name").map((n) => n.text())).toEqual([
      "screenshot",
    ]);
    wrapper.unmount();
  });

  it("arms Reset first, then DELETEs with the FULL tool name", async () => {
    const reset = vi.fn(async () => makeOverriddenTool({ hasOverride: false }));
    const wrapper = mountSection(
      makeClient({
        toolPolicies: {
          list: async () => ({ tools: [makeOverriddenTool()] }),
          save: async () => makeOverriddenTool(),
          reset,
        },
      }),
      { kind: "global" },
    );
    await flushPromises();

    const button = wrapper.get(".reset-button");
    await button.trigger("click");
    expect(reset).not.toHaveBeenCalled();
    expect(button.text()).toContain("Sure?");

    await button.trigger("click");
    await flushPromises();
    expect(reset).toHaveBeenCalledWith("mcp__vynel__memory_save");
    wrapper.unmount();
  });

  it("greys a Pro row the live entitlement lacks", async () => {
    const wrapper = mountSection(
      makeClient({
        hub: {
          getSession: async () => ({
            kind: "signed-in",
            tier: "basic",
            features: ["channels"],
          }),
        },
      }),
      { kind: "global" },
    );
    await flushPromises();

    expect(wrapper.findAll(".pro-chip")).toHaveLength(1);
    expect(wrapper.findAll(".lock-chip")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("ToolPolicySection — capabilities", () => {
  it("workspace scope renders the panel and a switch drives setEnabled", async () => {
    const list = vi.fn(async () => ({
      capabilities: [
        {
          id: "memory",
          displayName: "Memory",
          description: "Remembers facts about you and your work.",
          scope: "workspace",
          isFirstParty: true,
          isEnabled: true,
        },
      ],
    }));
    const setEnabled = vi.fn(async () => undefined);
    const wrapper = mountSection(
      makeClient({ capabilities: { list, setEnabled } }),
      { kind: "workspace", workspaceId: "w1" },
    );
    await flushPromises();

    expect(list).toHaveBeenCalledWith("w1");
    expect(wrapper.text()).toContain("Capabilities");
    expect(wrapper.text()).toContain("Memory");

    await wrapper.get(".capability-switch").trigger("click");
    await flushPromises();
    expect(setEnabled).toHaveBeenCalledWith("w1", "memory", {
      isEnabled: false,
    });
    wrapper.unmount();
  });

  it("global scope shows the per-workspace hint and never fetches the roster", async () => {
    const list = vi.fn(async () => ({ capabilities: [] }));
    const wrapper = mountSection(
      makeClient({ capabilities: { list, setEnabled: async () => undefined } }),
      { kind: "global" },
    );
    await flushPromises();

    expect(list).not.toHaveBeenCalled();
    expect(wrapper.find(".capability-panel").exists()).toBe(false);
    expect(wrapper.get(".capabilities-hint").text()).toContain(
      "per workspace",
    );
    wrapper.unmount();
  });
});
