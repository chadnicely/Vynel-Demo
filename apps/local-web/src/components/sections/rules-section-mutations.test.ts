// The Rules view's write doors: "Write a rule" opens the dialog and saves a
// kebab-named file at the surface's scope, Edit re-opens the row's content
// under its fixed name (and warns when the rule is a marketplace install),
// and Delete arms before it fires.

import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import RulesSection from "./RulesSection.vue";
import { slugifyRuleName } from "./rule-name-slug.js";
import type { SectionScope } from "./section-scope.js";

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "git-hygiene",
    fileName: "git-hygiene.md",
    title: "Git hygiene",
    content: "# Git hygiene\n\nSmall commits.",
    body: "# Git hygiene\n\nSmall commits.",
    scope: "user",
    marketplace: null,
    ...overrides,
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    rules: {
      list: async () => ({ rules: [makeRule()] }),
      write: vi.fn(async () => makeRule()),
      delete: vi.fn(async () => undefined),
    },
    rulesUser: { list: async () => ({ rules: [makeRule()] }) },
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

describe("RulesSection — writing", () => {
  it("writes a new rule at the workspace scope under a kebab name", async () => {
    const client = makeClient();
    const wrapper = mount(RulesSection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } as SectionScope,
      },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get("button.inline-flex").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    expect(dialog.textContent).toContain("Write a rule");

    await setValue(dialog.querySelector("input")!, "Writing style");
    await setValue(
      dialog.querySelector("textarea")!,
      "# Writing style\n\nWarm, brief.",
    );
    expect(dialog.textContent).toContain("writing-style.md");

    const save = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save rule"),
    )!;
    save.click();
    await flushPromises();

    expect(client.rules.write).toHaveBeenCalledWith("writing-style", {
      scope: "workspace",
      workspaceId: "w1",
      content: "# Writing style\n\nWarm, brief.",
    });
    wrapper.unmount();
  });

  it("edits under the fixed name and warns when the rule is a marketplace install", async () => {
    const client = makeClient({
      rulesUser: {
        list: async () => ({
          rules: [
            makeRule({
              marketplace: { ruleId: "git-hygiene", version: "2.1.0" },
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

    await wrapper.get(".edit-button").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    expect(dialog.textContent).toContain("Edit rule");
    expect(dialog.textContent).toContain("came from the Marketplace");
    expect((dialog.querySelector("input") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (dialog.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toContain("Small commits.");

    await setValue(
      dialog.querySelector("textarea")!,
      "# Git hygiene\n\nTiny commits.",
    );
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save rule"))!
      .click();
    await flushPromises();

    expect(client.rules.write).toHaveBeenCalledWith("git-hygiene", {
      scope: "user",
      content: "# Git hygiene\n\nTiny commits.",
    });
    wrapper.unmount();
  });

  it("arms delete on the first click and fires on the second", async () => {
    const client = makeClient();
    const wrapper = mount(RulesSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    const remove = wrapper.get(".delete-button");
    await remove.trigger("click");
    expect(remove.text()).toBe("Sure?");
    expect(client.rules.delete).not.toHaveBeenCalled();

    await remove.trigger("click");
    await flushPromises();
    expect(client.rules.delete).toHaveBeenCalledWith("git-hygiene", {
      scope: "user",
    });
    wrapper.unmount();
  });
});

describe("slugifyRuleName", () => {
  it("turns a typed name into a safe kebab file name", () => {
    expect(slugifyRuleName("  Writing Style!  ")).toBe("writing-style");
    expect(slugifyRuleName("règles d'équipe")).toBe("r-gles-d-quipe");
    expect(slugifyRuleName("---")).toBe("");
  });
});
