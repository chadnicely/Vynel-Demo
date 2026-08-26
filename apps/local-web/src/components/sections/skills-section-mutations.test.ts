// The Skills shelf's doors: "Write a skill" saves the parts at the surface's
// scope under a slugged id and opens the file editor on it, a row opens the
// editor (file list + the open file, save per file, add a file), the source
// chip reads "On disk" for a discovered skill, and Uninstall arms first.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, type Plugin } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import SkillsSection from "./SkillsSection.vue";
import { slugifySkillName } from "./skill-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// CodeMirror mounts lazily against a real DOM; the editor's behaviour is
// not under test here, so a textarea stands in and keeps v-model honest.
vi.mock("../workspace/CodeEditor.vue", () => ({
  default: defineComponent({
    props: { modelValue: { type: String, default: "" }, language: String, placeholder: String },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () =>
        h("textarea", {
          class: "code-editor-stub",
          value: props.modelValue,
          onInput: (event: Event) =>
            emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
        });
    },
  }),
}));

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    skillId: "recipe-box",
    scope: "user",
    workspaceId: null,
    installedFromSource: "user",
    versionInstalled: "unknown",
    installHealth: "healthy",
    installHealthMessage: null,
    installedAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    definition: null,
    resolvedSettings: {},
    ...overrides,
  };
}

function makeFilesResponse(relativePath = "SKILL.md") {
  return {
    skillId: "recipe-box",
    scope: "user",
    files: [
      { relativePath: "SKILL.md", sizeBytes: 40, isText: true },
      { relativePath: "references/units.md", sizeBytes: 8, isText: true },
      { relativePath: "logo.png", sizeBytes: 4, isText: false },
    ],
    file: {
      relativePath,
      content: relativePath === "SKILL.md" ? "---\nname: recipe-box\n---\nLook it up.\n" : "# Units\n",
    },
  };
}

function makeClient(options: Record<string, unknown> = {}) {
  return {
    skills: {
      listInstalled: async () => [makeSkill()],
      create: vi.fn(async () => makeSkill()),
      getFiles: vi.fn(async (_skillId: string, query: { relativePath?: string }) =>
        makeFilesResponse(query.relativePath ?? "SKILL.md"),
      ),
      writeFile: vi.fn(async () => makeFilesResponse()),
      deleteFile: vi.fn(async () => undefined),
      uninstallByScope: vi.fn(async () => undefined),
    },
    skillsUser: { listInstalled: async () => [makeSkill()] },
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

describe("SkillsSection — doors", () => {
  it("chips a discovered skill as On disk and a user-written one with nothing", async () => {
    const client = makeClient({
      skillsUser: {
        listInstalled: async () => [
          makeSkill(),
          makeSkill({ id: "row-2", skillId: "found", installedFromSource: "external" }),
        ],
      },
    });
    const wrapper = mount(SkillsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();
    const rows = wrapper.findAll(".row");
    expect(rows[0]!.text()).not.toContain("On disk");
    expect(rows[1]!.text()).toContain("On disk");
    wrapper.unmount();
  });

  it("writes a new skill at the workspace scope and opens its editor", async () => {
    const client = makeClient();
    const wrapper = mount(SkillsSection, {
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
    await setValue(inputs[0]!, "Weekly Report");
    await setValue(inputs[1]!, "Use when asked for the Friday update");
    await setValue(dialog.querySelector("textarea")!, "Collect the week's wins.");
    expect(dialog.textContent).toContain("weekly-report/SKILL.md");

    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save skill"))!
      .click();
    await flushPromises();

    expect(client.skills.create).toHaveBeenCalledWith({
      scope: "workspace",
      workspaceId: "w1",
      skillId: "weekly-report",
      description: "Use when asked for the Friday update",
      body: "Collect the week's wins.",
    });
    // The editor opens on the new skill.
    expect(client.skills.getFiles).toHaveBeenCalledWith("weekly-report", {
      scope: "workspace",
      workspaceId: "w1",
      relativePath: "SKILL.md",
    });
    wrapper.unmount();
  });

  it("opens the file editor, switches files, saves the open file, adds a file", async () => {
    const client = makeClient();
    const wrapper = mount(SkillsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".row-open").trigger("click");
    await flushPromises();
    const dialog = lastDialog();
    const fileRows = [...dialog.querySelectorAll(".file-row")];
    expect(fileRows.map((row) => row.textContent?.trim())).toEqual([
      "SKILL.md",
      "references/units.md",
      "logo.png",
    ]);
    expect((dialog.querySelector(".code-editor-stub") as HTMLTextAreaElement).value).toContain(
      "Look it up.",
    );

    fileRows[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(client.skills.getFiles).toHaveBeenLastCalledWith("recipe-box", {
      scope: "user",
      relativePath: "references/units.md",
    });
    const editor = lastDialog().querySelector(".code-editor-stub") as HTMLTextAreaElement;
    expect(editor.value).toBe("# Units\n");

    await setValue(editor, "# Units\n\nMetric first.\n");
    (lastDialog().querySelector(".save-file") as HTMLButtonElement).click();
    await flushPromises();
    expect(client.skills.writeFile).toHaveBeenCalledWith("recipe-box", {
      scope: "user",
      relativePath: "references/units.md",
      content: "# Units\n\nMetric first.\n",
    });

    (lastDialog().querySelector(".add-file-button") as HTMLButtonElement).click();
    await flushPromises();
    await setValue(lastDialog().querySelector(".add-file input")!, "templates/card.md");
    lastDialog().querySelector(".add-file")!.dispatchEvent(new Event("submit", { bubbles: true }));
    await flushPromises();
    expect(client.skills.writeFile).toHaveBeenLastCalledWith("recipe-box", {
      scope: "user",
      relativePath: "templates/card.md",
      content: "",
    });
    wrapper.unmount();
  });

  it("parks a file switch while the open file is dirty — Save & continue writes first", async () => {
    const client = makeClient();
    const wrapper = mount(SkillsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    await wrapper.get(".row-open").trigger("click");
    await flushPromises();
    const editor = lastDialog().querySelector(".code-editor-stub") as HTMLTextAreaElement;
    await setValue(editor, "---\nname: recipe-box\n---\nEdited but unsaved.\n");

    [...lastDialog().querySelectorAll(".file-row")][1]!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushPromises();
    // Still on SKILL.md, with the notice up and nothing fetched for the other file.
    expect(lastDialog().querySelector(".unsaved-notice")).not.toBeNull();
    expect(client.skills.getFiles).not.toHaveBeenCalledWith("recipe-box", {
      scope: "user",
      relativePath: "references/units.md",
    });

    (lastDialog().querySelector(".save-and-continue") as HTMLButtonElement).click();
    await flushPromises();
    expect(client.skills.writeFile).toHaveBeenCalledWith("recipe-box", {
      scope: "user",
      relativePath: "SKILL.md",
      content: "---\nname: recipe-box\n---\nEdited but unsaved.\n",
    });
    expect(client.skills.getFiles).toHaveBeenLastCalledWith("recipe-box", {
      scope: "user",
      relativePath: "references/units.md",
    });
    wrapper.unmount();
  });

  it("arms uninstall on the first click and fires on the second", async () => {
    const client = makeClient();
    const wrapper = mount(SkillsSection, {
      props: { scope: { kind: "global" } as SectionScope },
      ...mountOptions(client),
    });
    await flushPromises();

    const remove = wrapper.get(".uninstall-button");
    await remove.trigger("click");
    expect(remove.text()).toBe("Sure?");
    expect(client.skills.uninstallByScope).not.toHaveBeenCalled();

    await remove.trigger("click");
    await flushPromises();
    expect(client.skills.uninstallByScope).toHaveBeenCalledWith("recipe-box", { scope: "user" });
    wrapper.unmount();
  });
});

describe("slugifySkillName", () => {
  it("kebabs a typed name", () => {
    expect(slugifySkillName("  Weekly Report! ")).toBe("weekly-report");
    expect(slugifySkillName("---")).toBe("");
  });
});
