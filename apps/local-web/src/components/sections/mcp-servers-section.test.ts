// The MCP Servers view. Guards the security posture — header/env VALUES are
// never in the DOM (the wire carries names + presence only, and the section
// renders bullets) — plus the surface split, the armed remove routed to the
// row's OWN scope, and the transport/scope chips.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import McpServersSection from "./McpServersSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeRemoteServer(overrides: Record<string, unknown> = {}) {
  return {
    serverName: "linear",
    scope: "user",
    transport: "http",
    commandOrUrl: "https://mcp.example.com/mcp",
    args: [],
    environmentKeys: [],
    headers: [{ name: "Authorization", hasValue: true }],
    ...overrides,
  };
}

function makeStdioServer(overrides: Record<string, unknown> = {}) {
  return {
    serverName: "playwright",
    scope: "workspace",
    transport: "stdio",
    commandOrUrl: "npx",
    args: ["@playwright/mcp@latest"],
    environmentKeys: ["API_KEY"],
    headers: [],
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    mcpServers: {
      list: async () => ({ servers: [makeStdioServer()] }),
      remove: async () => undefined,
    },
    mcpServersUser: {
      list: async () => ({ servers: [makeRemoteServer()] }),
      remove: async () => undefined,
    },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
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
  return mount(McpServersSection, {
    props: { scope },
    global: {
      plugins,
      provide: { [vynelClientKey as symbol]: client },
    },
  });
}

describe("McpServersSection — masking", () => {
  it("renders header NAMES with bullets — no value ever hits the DOM", async () => {
    const wrapper = mountSection(makeClient(), { kind: "global" });
    await flushPromises();

    expect(wrapper.text()).toContain("Authorization");
    expect(wrapper.text()).toContain("••••••");
    // The masked wire shape has no value field at all; assert the DOM shows
    // nothing that even looks like a bearer credential.
    expect(wrapper.html()).not.toContain("Bearer");
    wrapper.unmount();
  });

  it("renders env var NAMES with bullets on stdio rows", async () => {
    const wrapper = mountSection(makeClient(), {
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    expect(wrapper.text()).toContain("API_KEY");
    expect(wrapper.text()).toContain("••••••");
    wrapper.unmount();
  });
});

describe("McpServersSection — surfaces", () => {
  it("asks the user route on the global surface; chips transport + scope", async () => {
    const list = vi.fn(async () => ({ servers: [makeRemoteServer()] }));
    const wrapper = mountSection(
      makeClient({ mcpServersUser: { list, remove: async () => undefined } }),
      { kind: "global" },
    );
    await flushPromises();

    expect(list).toHaveBeenCalledWith();
    expect(wrapper.text()).toContain("linear");
    expect(wrapper.findAll(".transport-chip").map((c) => c.text())).toContain("http");
    expect(wrapper.findAll(".scope-chip").map((c) => c.text())).toContain("Global");
    wrapper.unmount();
  });

  it("asks the workspace route (fusion) on the workspace surface", async () => {
    const list = vi.fn(async () => ({
      servers: [makeRemoteServer(), makeStdioServer()],
    }));
    const wrapper = mountSection(
      makeClient({ mcpServers: { list, remove: async () => undefined } }),
      { kind: "workspace", workspaceId: "w1" },
    );
    await flushPromises();

    expect(list).toHaveBeenCalledWith("w1");
    const chips = wrapper.findAll(".scope-chip").map((c) => c.text());
    expect(chips).toContain("Global");
    expect(chips).toContain("vynel");
    wrapper.unmount();
  });
});

describe("McpServersSection — remove", () => {
  it("arms first, then removes via the row's OWN scope (workspace row → workspace route)", async () => {
    const removeWorkspace = vi.fn(async () => undefined);
    const removeUser = vi.fn(async () => undefined);
    const wrapper = mountSection(
      makeClient({
        mcpServers: {
          list: async () => ({ servers: [makeStdioServer()] }),
          remove: removeWorkspace,
        },
        mcpServersUser: {
          list: async () => ({ servers: [] }),
          remove: removeUser,
        },
      }),
      { kind: "workspace", workspaceId: "w1" },
    );
    await flushPromises();

    const button = wrapper.get(".remove-button");
    await button.trigger("click");
    expect(removeWorkspace).not.toHaveBeenCalled();
    expect(button.text()).toContain("Sure?");

    await button.trigger("click");
    await flushPromises();
    expect(removeWorkspace).toHaveBeenCalledWith("w1", "playwright");
    expect(removeUser).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("a Global row on a workspace surface removes via the user route", async () => {
    const removeWorkspace = vi.fn(async () => undefined);
    const removeUser = vi.fn(async () => undefined);
    const wrapper = mountSection(
      makeClient({
        mcpServers: {
          list: async () => ({ servers: [makeRemoteServer()] }),
          remove: removeWorkspace,
        },
        mcpServersUser: {
          list: async () => ({ servers: [] }),
          remove: removeUser,
        },
      }),
      { kind: "workspace", workspaceId: "w1" },
    );
    await flushPromises();

    const button = wrapper.get(".remove-button");
    await button.trigger("click");
    await button.trigger("click");
    await flushPromises();

    expect(removeUser).toHaveBeenCalledWith("linear");
    expect(removeWorkspace).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
