// The Agents shelf's human doors: hand-authored agent files ride the shelf
// with an "On disk" chip, "Build an agent" creates at the surface's scope
// (slug derived), Edit re-opens a Vynel agent's parts, the catalog dialog
// installs a curated agent, and both delete doors arm before they fire.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import AgentsSection from "./AgentsSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    slug: "focus-writer",
    name: "Focus Writer",
    description: "A persona for deep-focus writing.",
    icon: null,
    prompt: "You write with focus.",
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: ["Read", "Grep"],
    disallowedTools: null,
    scope: "user",
    workspaceId: null,
    source: "user",
    trustTier: "community",
    enabled: true,
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides,
  };
}

function makeAgentFile(overrides: Record<string, unknown> = {}) {
  return {
    slug: "reviewer",
    fileName: "reviewer.md",
    name: "reviewer",
    description: "Reviews code",
    tools: ["Read"],
    model: null,
    content: "---\nname: reviewer\ndescription: Reviews code\n---\n\nReview.\n",
    body: "Review.\n",
    scope: "user",
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    agents: {
      list: async () => [makeAgent()],
      listResolved: async () => [makeAgent()],
      listFiles: async () => ({ agentFiles: [makeAgentFile()] }),
      listCurated: async () => [
        {
          slug: "researcher",
          name: "Researcher",
          description: "Digs things up",
          iconName: "search",
          prompt: "Research.",
          model: null,
          effort: null,
          permissionMode: null,
          background: false,
          allowedTools: null,
          disallowedTools: null,
          skillIds: [],
          recommendedScope: "user",
        },
      ],
      setEnabled: vi.fn(async () => makeAgent({ enabled: false })),
      create: vi.fn(async () => makeAgent()),
      update: vi.fn(async () => makeAgent()),
      delete: vi.fn(async () => undefined),
      installCurated: vi.fn(async () => makeAgent({ slug: "researcher" })),
      writeFile: vi.fn(async () => makeAgentFile()),
      deleteFile: vi.fn(async () => undefined),
    },
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

function lastDialog(): HTMLElement {
  const dialogs =
    document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs[dialogs.length - 1]!;
}

async function setValue(element: Element, value: string) {
  (element as HTMLInputElement).value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
}

describe("AgentsSection — doors", () => {
  it("lists hand-authored agent files beside Vynel agents with an On disk chip", async () => {
    const wrapper = mount(AgentsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(makeClient()),
    });
    await flushPromises();
    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("Focus Writer");
    expect(rows[1]!.text()).toContain("reviewer");
    expect(rows[1]!.text()).toContain("On disk");
    wrapper.unmount();
  });

  it("builds an agent at the workspace scope with a derived slug", async () => {
    const client = makeClient();
    const wrapper = mount(AgentsSection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } as SectionScope,
      },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".build-button").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    const inputs = dialog.querySelectorAll("input");
    await setValue(inputs[0]!, "Research Assistant");
    await setValue(inputs[1]!, "Use for background research");
    await setValue(dialog.querySelector("textarea")!, "Research thoroughly.");
    await setValue(inputs[2]!, "Read, WebSearch");
    expect(dialog.textContent).toContain("@research-assistant");

    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save agent"))!
      .click();
    await flushPromises();

    expect(client.agents.create).toHaveBeenCalledWith({
      slug: "research-assistant",
      name: "Research Assistant",
      description: "Use for background research",
      prompt: "Research thoroughly.",
      allowedTools: ["Read", "WebSearch"],
      scope: "workspace",
      workspaceId: "w1",
    });
    wrapper.unmount();
  });

  it("edits a Vynel agent's parts under its fixed slug", async () => {
    const client = makeClient();
    const wrapper = mount(AgentsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".edit-button").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    expect(dialog.textContent).toContain("Edit agent");
    const inputs = dialog.querySelectorAll("input");
    expect(inputs[0]!.value).toBe("Focus Writer");
    expect(inputs[2]!.value).toBe("Read, Grep");
    await setValue(dialog.querySelector("textarea")!, "You write with more focus.");
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save agent"))!
      .click();
    await flushPromises();

    expect(client.agents.update).toHaveBeenCalledWith("a1", {
      name: "Focus Writer",
      description: "A persona for deep-focus writing.",
      prompt: "You write with more focus.",
      model: null,
      allowedTools: ["Read", "Grep"],
    });
    wrapper.unmount();
  });

  it("installs a curated agent from the catalog dialog", async () => {
    const client = makeClient();
    const wrapper = mount(AgentsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".catalog-button").trigger("click");
    await flushPromises();
    (lastDialog().querySelector(".add-curated") as HTMLButtonElement).click();
    await flushPromises();
    expect(client.agents.installCurated).toHaveBeenCalledWith({ slug: "researcher", scope: "user" });
    wrapper.unmount();
  });

  it("arms both delete doors before firing them", async () => {
    const client = makeClient();
    const wrapper = mount(AgentsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    const removeAgent = wrapper.get(".delete-button");
    await removeAgent.trigger("click");
    expect(removeAgent.text()).toBe("Sure?");
    await removeAgent.trigger("click");
    await flushPromises();
    expect(client.agents.delete).toHaveBeenCalledWith("a1");

    const removeFile = wrapper.get(".delete-file-button");
    await removeFile.trigger("click");
    expect(removeFile.text()).toBe("Sure?");
    await removeFile.trigger("click");
    await flushPromises();
    expect(client.agents.deleteFile).toHaveBeenCalledWith("reviewer", { scope: "user" });
    wrapper.unmount();
  });

  it("edits a hand-authored file raw and saves it under its slug", async () => {
    const client = makeClient();
    const wrapper = mount(AgentsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".edit-file-button").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    expect((dialog.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    await setValue(dialog.querySelector("textarea")!, "---\nname: reviewer\ndescription: Reviews twice\n---\n\nReview twice.\n");
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save file"))!
      .click();
    await flushPromises();
    expect(client.agents.writeFile).toHaveBeenCalledWith("reviewer", {
      scope: "user",
      content: "---\nname: reviewer\ndescription: Reviews twice\n---\n\nReview twice.\n",
    });
    wrapper.unmount();
  });
});
