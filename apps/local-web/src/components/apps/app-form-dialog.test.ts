import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import AppFormDialog from "./AppFormDialog.vue";

function makeApp(
  overrides: Partial<WorkspaceAppResponse> = {},
): WorkspaceAppResponse {
  return {
    id: "a1",
    userId: "u1",
    workspaceId: "w1",
    name: "Web app",
    command: "pnpm --filter web dev",
    cwdRelative: "apps/web",
    port: 5173,
    runtime: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
    ...overrides,
  };
}

function makeHarness(app: WorkspaceAppResponse | null = null) {
  const addCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const client = {
    workspaceApps: {
      add: async (workspaceId: string, input: unknown) => {
        addCalls.push([workspaceId, input]);
        return makeApp();
      },
      update: async (workspaceId: string, appId: string, patch: unknown) => {
        updateCalls.push([workspaceId, appId, patch]);
        return makeApp();
      },
    },
  } as unknown as VynelClient;

  const wrapper = mount(AppFormDialog, {
    props: { open: true, workspaceId: "w1", app },
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
  return { wrapper, addCalls, updateCalls };
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

function field(dialog: HTMLElement, label: string): HTMLInputElement {
  return dialog.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
}

async function typeInto(dialog: HTMLElement, label: string, text: string) {
  const input = field(dialog, label);
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
}

function clickButton(dialog: HTMLElement, label: string) {
  const button = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  button.click();
}

describe("AppFormDialog — add", () => {
  it("submits every filled field, folder and port included", async () => {
    const { wrapper, addCalls } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    await typeInto(dialog, "App name", "Web app");
    await typeInto(dialog, "Start command", "npm run dev");
    await typeInto(dialog, "Folder", "apps/web");
    await typeInto(dialog, "Port", "3000");
    clickButton(dialog, "Add app");
    await flushPromises();

    expect(addCalls).toEqual([
      [
        "w1",
        {
          name: "Web app",
          command: "npm run dev",
          cwdRelative: "apps/web",
          port: 3000,
        },
      ],
    ]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps the submit disabled until name and command are typed", async () => {
    const { wrapper } = makeHarness();
    await flushPromises();
    const dialog = dialogElement();

    const submit = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Add app",
    )!;
    expect(submit.disabled).toBe(true);

    await typeInto(dialog, "App name", "Web app");
    expect(submit.disabled).toBe(true);
    await typeInto(dialog, "Start command", "npm run dev");
    expect(submit.disabled).toBe(false);

    // A port that isn't one blocks the save too.
    await typeInto(dialog, "Port", "not-a-port");
    expect(submit.disabled).toBe(true);
    wrapper.unmount();
  });
});

describe("AppFormDialog — edit", () => {
  it("prefills the app's fields", async () => {
    const { wrapper } = makeHarness(makeApp());
    await flushPromises();
    const dialog = dialogElement();

    expect(field(dialog, "App name").value).toBe("Web app");
    expect(field(dialog, "Start command").value).toBe(
      "pnpm --filter web dev",
    );
    expect(field(dialog, "Folder").value).toBe("apps/web");
    expect(field(dialog, "Port").value).toBe("5173");
    wrapper.unmount();
  });

  it("saves the whole form as a patch (an emptied port clears it)", async () => {
    const { wrapper, updateCalls } = makeHarness(makeApp());
    await flushPromises();
    const dialog = dialogElement();

    await typeInto(dialog, "App name", "Renamed app");
    await typeInto(dialog, "Port", "");
    clickButton(dialog, "Save changes");
    await flushPromises();

    expect(updateCalls).toEqual([
      [
        "w1",
        "a1",
        {
          name: "Renamed app",
          command: "pnpm --filter web dev",
          cwdRelative: "apps/web",
          port: null,
        },
      ],
    ]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
    wrapper.unmount();
  });
});
