import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import ConnectChannelDialog from "./ConnectChannelDialog.vue";

function makeHarness() {
  const connectCalls: unknown[] = [];
  const client = {
    channelsUser: {
      connect: async (input: unknown) => {
        connectCalls.push(input);
        return { id: "ch-1" };
      },
    },
    workspaces: {
      list: async () => [
        {
          id: "w1",
          name: "vynel",
          isArchived: false,
        },
      ],
    },
  } as unknown as VynelClient;

  const wrapper = mount(ConnectChannelDialog, {
    props: { open: true, defaultScope: { kind: "global" as const } },
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
  return { wrapper, connectCalls };
}

function dialogElement(): HTMLElement {
  // Teleported dialogs accumulate in document.body across a file's tests —
  // the newest mount is the last one.
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

describe("ConnectChannelDialog", () => {
  it("connects a Telegram channel at the global scope with the typed token", async () => {
    const { wrapper, connectCalls } = makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    const token = dialog.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    token.value = "123456:ABC";
    token.dispatchEvent(new Event("input"));
    await flushPromises();

    dialog
      .querySelectorAll("button")
      .forEach((b) => b.textContent === "Connect" && b.click());
    await flushPromises();

    expect(connectCalls).toEqual([
      {
        scope: "global",
        channelKind: "telegram",
        displayName: "My Telegram",
        botCredentials: { botToken: "123456:ABC" },
      },
    ]);
    expect(wrapper.emitted("connected")).toHaveLength(1);
  });

  it("keeps Connect disabled without a token, and shows Discord as coming soon", async () => {
    makeHarness();
    await flushPromises();

    const dialog = dialogElement();
    const connect = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Connect",
    )!;
    expect(connect.disabled).toBe(true);
    expect(dialog.textContent).toContain("Coming soon");
  });
});
