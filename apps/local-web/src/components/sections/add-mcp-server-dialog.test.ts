// The custom-add form. Guards: the discriminated bodies each transport
// sends, the scope split (Global → user route, Workspace → workspace route +
// the teaching note), the client-side https policy mirror, and the disabled
// submit until the form is valid.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import AddMcpServerDialog from "./AddMcpServerDialog.vue";
import type { SectionScope } from "./section-scope.js";

function makeHarness(defaultScope: SectionScope = { kind: "global" }) {
  const addUser = vi.fn(async (body: unknown) => body);
  const addWorkspace = vi.fn(async (_workspaceId: string, body: unknown) => body);
  const client = {
    mcpServersUser: { add: addUser },
    mcpServers: { add: addWorkspace },
    workspaces: {
      list: async () => [{ id: "w1", name: "vynel", isArchived: false }],
    },
  } as unknown as VynelClient;

  const wrapper = mount(AddMcpServerDialog, {
    props: { open: true, defaultScope },
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
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, addUser, addWorkspace };
}

function dialogElement(): HTMLElement {
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function typeByPlaceholder(dialog: HTMLElement, placeholder: string, text: string) {
  const input = dialog.querySelector<HTMLInputElement>(
    `[placeholder="${placeholder}"]`,
  );
  if (!input) throw new Error(`no input with placeholder ${placeholder}`);
  await typeInto(input, text);
}

async function clickButton(dialog: HTMLElement, label: string) {
  const button = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  button.click();
  await flushPromises();
}

describe("AddMcpServerDialog — stdio", () => {
  it("sends the stdio body (command/args/env) to the user route by default", async () => {
    const { addUser, addWorkspace } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeByPlaceholder(dialog, "e.g. linear", "my-tool");
    await typeByPlaceholder(dialog, "e.g. npx", "npx");
    const args = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    await typeInto(args, "@playwright/mcp@latest\n--headless");
    await clickButton(dialog, "Add variable");
    await typeByPlaceholder(dialog, "NAME", "TOKEN");
    await typeByPlaceholder(dialog, "value", "secret-v");
    await clickButton(dialog, "Add server");

    expect(addWorkspace).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith({
      serverName: "my-tool",
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest", "--headless"],
      environment: { TOKEN: "secret-v" },
    });
  });
});

describe("AddMcpServerDialog — remote", () => {
  it("sends the remote body (url/headers) and refuses plain http", async () => {
    const { addUser } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeByPlaceholder(dialog, "e.g. linear", "linear");
    await clickButton(dialog, "Remote (HTTP)");
    await typeByPlaceholder(dialog, "https://example.com/mcp", "http://example.com/mcp");
    expect(dialog.textContent).toContain("https:// URL");
    await clickButton(dialog, "Add server");
    expect(addUser).not.toHaveBeenCalled();

    await typeByPlaceholder(dialog, "https://example.com/mcp", "https://mcp.example.com/mcp");
    await clickButton(dialog, "Add header");
    await typeByPlaceholder(dialog, "Authorization", "Authorization");
    await typeByPlaceholder(dialog, "Bearer …", "Bearer token-1");
    await clickButton(dialog, "Add server");

    expect(addUser).toHaveBeenCalledWith({
      serverName: "linear",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer token-1" },
    });
  });

  it("masks header values as password inputs (never readable on screen)", async () => {
    makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await clickButton(dialog, "Remote (SSE)");
    await clickButton(dialog, "Add header");
    const valueInput = dialog.querySelector<HTMLInputElement>(
      '[placeholder="Bearer …"]',
    )!;
    expect(valueInput.type).toBe("password");
  });
});

// SPEC CHANGE (2026-08-03): the surface decides the scope — no create modal
// asks again. The Global/Workspace picker is gone, so opening from a workspace
// posts to THAT workspace (it used to default to global on every surface and
// need a click), and the .mcp.json teaching note now rides the surface.
describe("AddMcpServerDialog — scope", () => {
  it("a workspace surface posts to the workspace route and teaches about .mcp.json", async () => {
    const { addUser, addWorkspace } = makeHarness({
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();
    const dialog = dialogElement();

    expect(dialog.textContent).toContain(".mcp.json");
    expect(dialog.textContent).toContain(".gitignore");
    // Nothing to pick — the scope came in with the surface.
    expect(
      [...dialog.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Workspace",
      ),
    ).toBe(false);

    await typeByPlaceholder(dialog, "e.g. linear", "ws-tool");
    await typeByPlaceholder(dialog, "e.g. npx", "node");
    await clickButton(dialog, "Add server");

    expect(addUser).not.toHaveBeenCalled();
    expect(addWorkspace).toHaveBeenCalledWith("w1", {
      serverName: "ws-tool",
      transport: "stdio",
      command: "node",
      args: [],
      environment: {},
    });
  });

  it("keeps Add server disabled until name and command are present", async () => {
    const { addUser } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await clickButton(dialog, "Add server");
    expect(addUser).not.toHaveBeenCalled();

    const button = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Add server",
    )!;
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
