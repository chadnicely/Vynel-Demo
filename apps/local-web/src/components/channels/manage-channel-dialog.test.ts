import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import ManageChannelDialog from "./ManageChannelDialog.vue";

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    userId: "u1",
    workspaceId: null,
    channelKind: "telegram",
    displayName: "My Telegram",
    botMetadata: {},
    connectionStatus: "healthy",
    connectionStatusMessage: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: "2026-07-05T10:00:00.000Z",
    updatedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeSender(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    channelId: "c1",
    externalSenderId: "888",
    externalSenderHandle: "@bob",
    externalSenderDisplayName: "Bob",
    scopeContextId: null,
    addedAt: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeHarness(clientOverrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {
    rename: [],
    enable: [],
    disable: [],
    addAllowedSender: [],
    removeAllowedSender: [],
  };
  const client = {
    channelsUser: {
      list: async () => [makeChannel()],
      listAllowedSenders: async () => [makeSender()],
      rename: async (channelId: string, input: unknown) => {
        calls.rename!.push([channelId, input]);
        return makeChannel();
      },
      enable: async (channelId: string) => {
        calls.enable!.push(channelId);
        return makeChannel();
      },
      disable: async (channelId: string) => {
        calls.disable!.push(channelId);
        return makeChannel({ isEnabled: false });
      },
      addAllowedSender: async (channelId: string, input: unknown) => {
        calls.addAllowedSender!.push([channelId, input]);
        return makeSender({ id: "s2" });
      },
      removeAllowedSender: async (channelId: string, senderLinkId: string) => {
        calls.removeAllowedSender!.push([channelId, senderLinkId]);
      },
      ...clientOverrides,
    },
  } as unknown as VynelClient;

  const wrapper = mount(ManageChannelDialog, {
    props: { open: true, channelId: "c1" },
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
  return { wrapper, calls };
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

describe("ManageChannelDialog", () => {
  it("seeds the name from the resolved row and renames on Save", async () => {
    const { calls } = makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    const nameInput = dialog.querySelector<HTMLInputElement>(
      'input[maxlength="120"]',
    )!;
    expect(nameInput.value).toBe("My Telegram");

    nameInput.value = "Family bot";
    nameInput.dispatchEvent(new Event("input"));
    await flushPromises();

    [...dialog.querySelectorAll("button")]
      .find((b) => b.textContent === "Save")!
      .click();
    await flushPromises();

    expect(calls.rename).toEqual([["c1", { displayName: "Family bot" }]]);
  });

  it("keeps Save disabled while the name is unchanged or empty", async () => {
    makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    const save = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Save",
    )!;
    expect(save.disabled).toBe(true);
  });

  it("pauses an active channel from the status pill", async () => {
    const { calls } = makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Pause My Telegram"]')!
      .click();
    await flushPromises();

    expect(calls.disable).toEqual(["c1"]);
    expect(calls.enable).toEqual([]);
  });

  it("resumes a paused channel from the status pill", async () => {
    const { calls } = makeHarness({
      list: async () => [makeChannel({ isEnabled: false })],
    });
    await flushPromises();

    const dialog = dialogElement();
    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Resume My Telegram"]')!
      .click();
    await flushPromises();

    expect(calls.enable).toEqual(["c1"]);
    expect(calls.disable).toEqual([]);
  });

  it("lists allowed senders and adds one with only the typed fields", async () => {
    const { calls } = makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    expect(dialog.textContent).toContain("Bob");

    const idInput = dialog.querySelector<HTMLInputElement>(
      'input[placeholder^="User ID"]',
    )!;
    idInput.value = " 999 ";
    idInput.dispatchEvent(new Event("input"));
    await flushPromises();

    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Add allowed sender"]')!
      .click();
    await flushPromises();

    // Trimmed id; the untouched optional fields are OMITTED, not sent empty.
    expect(calls.addAllowedSender).toEqual([
      ["c1", { externalSenderId: "999" }],
    ]);
  });

  it("removes a sender only on the second, armed click", async () => {
    const { calls } = makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Remove Bob"]')!
      .click();
    await flushPromises();
    expect(calls.removeAllowedSender).toEqual([]);

    dialog
      .querySelector<HTMLButtonElement>('[aria-label="Confirm remove Bob"]')!
      .click();
    await flushPromises();
    expect(calls.removeAllowedSender).toEqual([["c1", "s1"]]);
  });
});
