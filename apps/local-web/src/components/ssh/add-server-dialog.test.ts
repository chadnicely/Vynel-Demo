import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import type { SectionScope } from "../sections/section-scope.js";
import AddServerDialog from "./AddServerDialog.vue";

function makeHarness(defaultScope: SectionScope) {
  const addCalls: unknown[] = [];
  const client = {
    sshServers: {
      add: async (input: unknown) => {
        addCalls.push(input);
        return { id: "srv-1" };
      },
    },
  } as unknown as VynelClient;

  const wrapper = mount(AddServerDialog, {
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
        ] as [typeof VueQueryPlugin, unknown],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, addCalls };
}

function dialogElement(): HTMLElement {
  // Teleported dialogs accumulate in document.body across a file's tests —
  // the newest mount is the last one.
  const dialogs =
    document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

async function typeInto(dialog: HTMLElement, label: string, text: string) {
  const field = dialog.querySelector<HTMLInputElement>(
    `[aria-label="${label}"]`,
  )!;
  field.value = text;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function fillConnectionFields(dialog: HTMLElement) {
  await typeInto(dialog, "Server name", "My web server");
  await typeInto(dialog, "Server address", "example.com");
  await typeInto(dialog, "Username", "root");
}

function submit(dialog: HTMLElement) {
  const button = [...dialog.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Add server",
  )!;
  button.click();
}

describe("AddServerDialog", () => {
  it("adds a password server at the global scope", async () => {
    const { wrapper, addCalls } = makeHarness({ kind: "global" });
    await flushPromises();

    const dialog = dialogElement();
    await fillConnectionFields(dialog);
    await typeInto(dialog, "Password", "hunter two");

    submit(dialog);
    await flushPromises();

    expect(addCalls).toEqual([
      {
        scope: "global",
        name: "My web server",
        host: "example.com",
        port: 22,
        username: "root",
        credentials: { authKind: "password", password: "hunter two" },
      },
    ]);
    expect(wrapper.emitted("added")).toHaveLength(1);
    wrapper.unmount();
  });

  it("adds a private-key server with its optional passphrase", async () => {
    const { wrapper, addCalls } = makeHarness({ kind: "global" });
    await flushPromises();

    const dialog = dialogElement();
    await fillConnectionFields(dialog);

    const keyTab = [...dialog.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === "Private key",
    ) as HTMLButtonElement;
    keyTab.click();
    await flushPromises();

    const keyText = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc";
    await typeInto(dialog, "Private key", keyText);
    await typeInto(dialog, "Passphrase", "open sesame");

    submit(dialog);
    await flushPromises();

    expect(addCalls).toEqual([
      {
        scope: "global",
        name: "My web server",
        host: "example.com",
        port: 22,
        username: "root",
        credentials: {
          authKind: "private-key",
          privateKey: keyText,
          passphrase: "open sesame",
        },
      },
    ]);
    wrapper.unmount();
  });

  it("defaults to the workspace it was opened from", async () => {
    const { wrapper, addCalls } = makeHarness({
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    const dialog = dialogElement();
    await fillConnectionFields(dialog);
    await typeInto(dialog, "Password", "hunter two");

    submit(dialog);
    await flushPromises();

    expect(addCalls).toEqual([
      {
        scope: "workspace",
        workspaceId: "w1",
        name: "My web server",
        host: "example.com",
        port: 22,
        username: "root",
        credentials: { authKind: "password", password: "hunter two" },
      },
    ]);
    wrapper.unmount();
  });

  it("goes global from a workspace when 'available everywhere' is on", async () => {
    const { wrapper, addCalls } = makeHarness({
      kind: "workspace",
      workspaceId: "w1",
    });
    await flushPromises();

    const dialog = dialogElement();
    await fillConnectionFields(dialog);
    await typeInto(dialog, "Password", "hunter two");

    const toggle = dialog.querySelector<HTMLInputElement>(
      '[aria-label="Make it available everywhere"]',
    )!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await flushPromises();

    submit(dialog);
    await flushPromises();

    expect(addCalls).toEqual([
      {
        scope: "global",
        name: "My web server",
        host: "example.com",
        port: 22,
        username: "root",
        credentials: { authKind: "password", password: "hunter two" },
      },
    ]);
    wrapper.unmount();
  });

  it("keeps Add disabled without a credential, and never shows the scope toggle globally", async () => {
    makeHarness({ kind: "global" });
    await flushPromises();

    const dialog = dialogElement();
    await fillConnectionFields(dialog);

    const button = [...dialog.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Add server",
    )!;
    expect(button.disabled).toBe(true);
    expect(
      dialog.querySelector('[aria-label="Make it available everywhere"]'),
    ).toBeNull();
  });
});
