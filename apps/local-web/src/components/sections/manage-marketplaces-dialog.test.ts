// The trust door for third-party sources: lists what's registered, adds
// through the daemon (normalization is server-side), and removal arms
// before it fires (a removed source's rows leave the shelf).

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import ManageMarketplacesDialog from "./ManageMarketplacesDialog.vue";

function makeHarness(
  sources: Array<{
    marketplaceName: string;
    sourceUrl: string | null;
    ownerName: string | null;
    pluginCount: number;
  }> = [],
) {
  const add = vi.fn(async (body: unknown) => body);
  const remove = vi.fn(async () => undefined);
  const client = {
    marketplaceSources: { list: async () => ({ sources }), add, remove },
  } as unknown as VynelClient;

  const wrapper = mount(ManageMarketplacesDialog, {
    props: { open: true },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, add, remove };
}

function dialogElement(): HTMLElement {
  const dialogs = document.body.querySelectorAll<HTMLElement>('[role="dialog"]');
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) throw new Error("dialog did not render");
  return dialog;
}

const ACME = {
  marketplaceName: "acme-tools",
  sourceUrl: "https://github.com/acme/tools.git",
  ownerName: "Acme Inc",
  pluginCount: 2,
};

describe("ManageMarketplacesDialog", () => {
  it("lists registered sources and sends an add through the daemon", async () => {
    const { wrapper, add } = makeHarness([ACME]);
    await flushPromises();
    const dialog = dialogElement();
    expect(dialog.textContent).toContain("acme-tools");
    expect(dialog.textContent).toContain("2 plugins");

    const input = dialog.querySelector<HTMLInputElement>("input")!;
    input.value = "acme/other";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    const addButton = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Add marketplace",
    )!;
    addButton.click();
    await flushPromises();

    expect(add).toHaveBeenCalledWith({ source: "acme/other" });
    wrapper.unmount();
  });

  it("removal arms first and only the second click fires", async () => {
    const { wrapper, remove } = makeHarness([ACME]);
    await flushPromises();
    const dialog = dialogElement();

    const removeButton = [...dialog.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Remove marketplace"),
    )!;
    removeButton.click();
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();

    const confirmButton = [...dialog.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Confirm remove marketplace"),
    )!;
    confirmButton.click();
    await flushPromises();
    expect(remove).toHaveBeenCalledWith("acme-tools");
    wrapper.unmount();
  });
});
