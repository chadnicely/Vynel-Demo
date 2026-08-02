import { describe, expect, it } from "vitest";
import { flushPromises, mount, type MountingOptions } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import NotebookSection from "./NotebookSection.vue";
import WriteBookDialog from "./WriteBookDialog.vue";
import type { SectionScope } from "./section-scope.js";

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    userId: "u1",
    scope: "global",
    workspaceId: null,
    mode: "notebook",
    title: "How we publish the newsletter",
    body: "Draft on Monday, review on Tuesday, send on Wednesday.",
    enabled: true,
    sortOrder: 0,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

function globalConfig(
  client: VynelClient,
): NonNullable<MountingOptions<unknown>["global"]> {
  return {
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
    provide: { [vynelClientKey as symbol]: client },
  };
}

// No listPlaybooks/getPlaybook stubs on purpose: the verified shelf is
// Claude-internal and the section must never call the playbook endpoints —
// a regression would throw here, not silently render.
function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
    notebook: {
      listDocuments: async () => ({ documents: [] }),
      ...overrides,
    },
  } as unknown as VynelClient;
}

function latestDialog() {
  const dialogs =
    document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs[dialogs.length - 1]!;
}

describe("NotebookSection", () => {
  // test: correct expectation — the verified shelf left the UI (2026-07-27):
  // system playbooks are Claude-internal tooling, so the section shows only
  // the user's own books, with their edit/delete controls.
  it("shows only the user's own books — the verified shelf never renders", async () => {
    const client = makeClient({
      listDocuments: async () => ({ documents: [makeDocument()] }),
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(1);
    expect(wrapper.find(".is-verified").exists()).toBe(false);
    expect(wrapper.find(".verified-chip").exists()).toBe(false);
    expect(rows[0]!.findAll(".icon-button")).toHaveLength(2);
    expect(wrapper.text()).toContain("How we publish the newsletter");
  });

  it("renders an own book's body as markdown in the read dialog", async () => {
    const client = makeClient({
      listDocuments: async () => ({
        documents: [
          makeDocument({ body: "# The plan\nStep one: pick the stack." }),
        ],
      }),
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    await wrapper.find(".row.is-own button.row-open").trigger("click");
    await flushPromises();

    const dialog = latestDialog();
    expect(dialog.textContent).toContain("How we publish the newsletter");
    // The house MarkdownText renders the body (sanitized markdown, the
    // renderer chat uses) — the literal `#` heading marker is consumed, not
    // shown as raw source. (happy-dom's DOMPurify pass flattens the heading
    // element itself, so the marker — not the tag — is the stable signal.)
    const body = dialog.querySelector(".book-body")!;
    expect(body.querySelector(".markdown-text")).not.toBeNull();
    expect(body.textContent).toContain("The plan");
    expect(body.textContent).not.toContain("# The plan");
    expect(body.textContent).toContain("Step one: pick the stack.");
  });

  it("the global menu lists ONLY global books", async () => {
    const client = makeClient({
      listDocuments: async () => ({
        documents: [
          makeDocument(),
          makeDocument({
            id: "d2",
            scope: "workspace",
            workspaceId: "w1",
            title: "Workspace book",
          }),
        ],
      }),
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(1);
    expect(wrapper.text()).toContain("How we publish the newsletter");
    expect(wrapper.text()).not.toContain("Workspace book");
  });

  it("hides another workspace's books on a workspace surface, keeping global ones", async () => {
    const client = makeClient({
      listDocuments: async () => ({
        documents: [
          makeDocument(),
          makeDocument({
            id: "d2",
            scope: "workspace",
            workspaceId: "w2",
            title: "Other workspace book",
          }),
        ],
      }),
    });
    const wrapper = mount(NotebookSection, {
      props: {
        scope: { kind: "workspace", workspaceId: "w1" } satisfies SectionScope,
      },
      global: globalConfig(client),
    });
    await flushPromises();

    expect(wrapper.text()).toContain("How we publish the newsletter");
    expect(wrapper.text()).not.toContain("Other workspace book");
  });

  it("deletes an own book only after the armed second click", async () => {
    const deleted: string[] = [];
    const client = makeClient({
      listDocuments: async () => ({ documents: [makeDocument()] }),
      deleteDocument: async (documentId: string) => {
        deleted.push(documentId);
      },
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    // First click only arms — the book body is irrecoverable, so a single
    // click must never delete.
    await wrapper
      .find('[aria-label="Delete How we publish the newsletter"]')
      .trigger("click");
    await flushPromises();

    expect(deleted).toEqual([]);
    const armed = wrapper.find(
      '[aria-label="Confirm delete How we publish the newsletter"]',
    );
    expect(armed.text()).toBe("Sure?");

    // The second, explicit click fires the delete.
    await armed.trigger("click");
    await flushPromises();

    expect(deleted).toEqual(["d1"]);
  });

  it("disarms the delete confirm when the armed button loses focus", async () => {
    const deleted: string[] = [];
    const client = makeClient({
      listDocuments: async () => ({ documents: [makeDocument()] }),
      deleteDocument: async (documentId: string) => {
        deleted.push(documentId);
      },
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    await wrapper
      .find('[aria-label="Delete How we publish the newsletter"]')
      .trigger("click");
    const armed = wrapper.find(
      '[aria-label="Confirm delete How we publish the newsletter"]',
    );
    await armed.trigger("blur");

    expect(
      wrapper
        .find('[aria-label="Delete How we publish the newsletter"]')
        .exists(),
    ).toBe(true);
    expect(deleted).toEqual([]);
  });

  it("opens an own book from its keyboard-focusable row button", async () => {
    const client = makeClient({
      listDocuments: async () => ({ documents: [makeDocument()] }),
    });
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(client),
    });
    await flushPromises();

    // A real <button> opens the book, so Enter/Space work for free.
    const openButton = wrapper.find(".row.is-own button.row-open");
    expect(openButton.exists()).toBe(true);
    await openButton.trigger("click");
    await flushPromises();

    const dialog = latestDialog();
    expect(dialog.textContent).toContain("How we publish the newsletter");
    expect(dialog.textContent).toContain(
      "Draft on Monday, review on Tuesday, send on Wednesday.",
    );
  });

  it("explains what books are when the user has none yet", async () => {
    const wrapper = mount(NotebookSection, {
      props: { scope: { kind: "global" } satisfies SectionScope },
      global: globalConfig(makeClient()),
    });
    await flushPromises();

    expect(wrapper.text()).toContain(
      "Playbooks Claude reads when a task calls for them",
    );
    expect(wrapper.find(".invite-button").text()).toContain("Write a book");
    // No verified rows: with no own books the section is a clean invite.
    expect(wrapper.find(".row").exists()).toBe(false);
  });
});

describe("WriteBookDialog", () => {
  function makeWriteClient(calls: { create?: unknown[]; update?: unknown[] }) {
    return {
      workspaces: {
        list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
      },
      notebook: {
        createDocument: async (input: unknown) => {
          calls.create?.push(input);
          return makeDocument();
        },
        updateDocument: async (documentId: string, body: unknown) => {
          calls.update?.push([documentId, body]);
          return makeDocument();
        },
      },
    } as unknown as VynelClient;
  }

  function fillAndSave(dialog: HTMLElement, title: string, body: string) {
    const titleInput = dialog.querySelector<HTMLInputElement>(
      'input[type="text"]',
    )!;
    titleInput.value = title;
    titleInput.dispatchEvent(new Event("input"));
    const bodyInput = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    bodyInput.value = body;
    bodyInput.dispatchEvent(new Event("input"));
  }

  function clickButton(dialog: HTMLElement, label: string) {
    [...dialog.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === label)!
      .click();
  }

  it("creates a global book from the global surface", async () => {
    const createCalls: unknown[] = [];
    const wrapper = mount(WriteBookDialog, {
      props: {
        open: true,
        defaultScope: { kind: "global" } satisfies SectionScope,
      },
      global: globalConfig(makeWriteClient({ create: createCalls })),
    });
    await flushPromises();

    const dialog = latestDialog();
    fillAndSave(dialog, "Tone of voice", "Plain language, always.");
    await flushPromises();
    clickButton(dialog, "Save book");
    await flushPromises();

    expect(createCalls).toEqual([
      { title: "Tone of voice", body: "Plain language, always.", scope: "global" },
    ]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("defaults the scope picker to the section's workspace and sends its id", async () => {
    const createCalls: unknown[] = [];
    mount(WriteBookDialog, {
      props: {
        open: true,
        defaultScope: {
          kind: "workspace",
          workspaceId: "w1",
        } satisfies SectionScope,
      },
      global: globalConfig(makeWriteClient({ create: createCalls })),
    });
    await flushPromises();

    const dialog = latestDialog();
    fillAndSave(dialog, "Acme deploys", "Ship on Fridays. Kidding.");
    await flushPromises();
    clickButton(dialog, "Save book");
    await flushPromises();

    expect(createCalls).toEqual([
      {
        title: "Acme deploys",
        body: "Ship on Fridays. Kidding.",
        scope: "workspace",
        workspaceId: "w1",
      },
    ]);
  });

  it("edits an existing book (no scope picker) via updateDocument", async () => {
    const updateCalls: unknown[] = [];
    const wrapper = mount(WriteBookDialog, {
      props: {
        open: true,
        defaultScope: { kind: "global" } satisfies SectionScope,
        editing: { id: "d1", title: "Old title", body: "Old body." },
      },
      global: globalConfig(makeWriteClient({ update: updateCalls })),
    });
    await flushPromises();

    const dialog = latestDialog();
    // Scope is immutable after creation — no picker in edit mode.
    expect(dialog.textContent).not.toContain("Where it applies");
    fillAndSave(dialog, "New title", "New body.");
    await flushPromises();
    clickButton(dialog, "Save book");
    await flushPromises();

    expect(updateCalls).toEqual([
      ["d1", { title: "New title", body: "New body." }],
    ]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });
});
