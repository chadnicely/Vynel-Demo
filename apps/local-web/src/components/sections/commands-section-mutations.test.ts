// The Commands view's doors: a row opens its prompt read-only (frontmatter
// hidden), "Write a command" saves the parts at the surface's scope under a
// slugged name, Edit re-opens the parts under the fixed name, and Delete
// arms before it fires.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import CommandsSection from "./CommandsSection.vue";
import { slugifyCommandName } from "./command-name-slug.js";
import type { SectionScope } from "./section-scope.js";

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandName: "review",
    relativePath: "review.md",
    description: "Review a PR",
    argumentHint: "[pr]",
    bodyPreview: "Review PR $ARGUMENTS carefully.",
    content:
      '---\ndescription: "Review a PR"\nargument-hint: "[pr]"\n---\n\nReview PR $ARGUMENTS carefully.\n',
    body: "Review PR $ARGUMENTS carefully.\n",
    scope: "user",
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    commands: {
      list: async () => ({ commands: [makeCommand()] }),
      write: vi.fn(async () => makeCommand()),
      delete: vi.fn(async () => undefined),
    },
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

describe("CommandsSection — doors", () => {
  it("opens the prompt read-only with the frontmatter hidden", async () => {
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(makeClient()),
    });
    await flushPromises();

    await wrapper.get(".row-open").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    expect(dialog.textContent).toContain("/review");
    expect(dialog.textContent).toContain("Review PR $ARGUMENTS carefully.");
    expect(dialog.textContent).not.toContain("argument-hint");
    wrapper.unmount();
  });

  it("writes a new command at the workspace scope from its parts", async () => {
    const client = makeClient();
    const wrapper = mount(CommandsSection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } as SectionScope,
      },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get("button.inline-flex").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    const inputs = dialog.querySelectorAll("input");
    await setValue(inputs[0]!, "Git: Commit!");
    await setValue(inputs[1]!, "Commit the work");
    await setValue(dialog.querySelector("textarea")!, "Commit with a good message.");
    expect(dialog.textContent).toContain("/git:commit");

    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save command"))!
      .click();
    await flushPromises();

    expect(client.commands.write).toHaveBeenCalledWith("git:commit", {
      scope: "workspace",
      workspaceId: "w1",
      description: "Commit the work",
      argumentHint: null,
      body: "Commit with a good message.",
    });
    wrapper.unmount();
  });

  it("edits under the fixed name with the parts pre-filled", async () => {
    const client = makeClient();
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".edit-button").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    const inputs = dialog.querySelectorAll("input");
    expect(inputs[0]!.disabled).toBe(true);
    expect(inputs[0]!.value).toBe("review");
    expect(inputs[1]!.value).toBe("Review a PR");
    expect(inputs[2]!.value).toBe("[pr]");
    expect(dialog.querySelector("textarea")!.value).toBe(
      "Review PR $ARGUMENTS carefully.\n",
    );

    await setValue(dialog.querySelector("textarea")!, "Review PR $ARGUMENTS twice.");
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save command"))!
      .click();
    await flushPromises();

    expect(client.commands.write).toHaveBeenCalledWith("review", {
      scope: "user",
      description: "Review a PR",
      argumentHint: "[pr]",
      body: "Review PR $ARGUMENTS twice.",
    });
    wrapper.unmount();
  });

  it("arms delete on the first click and fires on the second", async () => {
    const client = makeClient();
    const wrapper = mount(CommandsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    const remove = wrapper.get(".delete-button");
    await remove.trigger("click");
    expect(remove.text()).toBe("Sure?");
    expect(client.commands.delete).not.toHaveBeenCalled();

    await remove.trigger("click");
    await flushPromises();
    expect(client.commands.delete).toHaveBeenCalledWith("review", {
      scope: "user",
    });
    wrapper.unmount();
  });
});

describe("slugifyCommandName", () => {
  it("kebabs each segment and keeps ':' as the folder separator", () => {
    expect(slugifyCommandName("/Git: Commit!")).toBe("git:commit");
    expect(slugifyCommandName("  Weekly Report ")).toBe("weekly-report");
    expect(slugifyCommandName("::")).toBe("");
  });
});
