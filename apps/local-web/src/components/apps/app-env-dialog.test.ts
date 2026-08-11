import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type {
  AppEnvResponse,
  WorkspaceAppResponse,
} from "@vynel/contracts/apps/app-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import AppEnvDialog from "./AppEnvDialog.vue";

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
    envFileRelative: ".env",
    port: 5173,
    runtime: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
    ...overrides,
  };
}

function makeHarness(file: AppEnvResponse) {
  const updateCalls: unknown[] = [];
  const client = {
    workspaceApps: {
      env: async () => file,
      updateEnv: async (
        workspaceId: string,
        appId: string,
        input: { entries: unknown[] },
      ) => {
        updateCalls.push([workspaceId, appId, input]);
        return { ...file, exists: true, entries: input.entries };
      },
    },
  } as unknown as VynelClient;

  const wrapper = mount(AppEnvDialog, {
    props: { open: true, workspaceId: "w1", app: makeApp() },
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
  return { wrapper, updateCalls };
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

function clickButton(dialog: HTMLElement, label: string) {
  const button = [...dialog.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no button labeled ${label}`);
  button.click();
}

describe("AppEnvDialog", () => {
  it("renders the file's entries with values MASKED until revealed", async () => {
    const { wrapper } = makeHarness({
      envFileRelative: ".env",
      exists: true,
      entries: [{ key: "DATABASE_URL", value: "postgres://localhost/dev" }],
    });
    await flushPromises();
    const dialog = dialogElement();

    expect(field(dialog, "Variable 1 name").value).toBe("DATABASE_URL");
    const valueInput = field(dialog, "Variable 1 value");
    expect(valueInput.value).toBe("postgres://localhost/dev");
    expect(valueInput.type).toBe("password"); // hidden by default

    clickButton(dialog, "Show values");
    await flushPromises();
    expect(field(dialog, "Variable 1 value").type).toBe("text");
    wrapper.unmount();
  });

  it("adds a variable and saves the FULL entry set", async () => {
    const { wrapper, updateCalls } = makeHarness({
      envFileRelative: ".env",
      exists: true,
      entries: [{ key: "API_KEY", value: "abc" }],
    });
    await flushPromises();
    const dialog = dialogElement();

    clickButton(dialog, "Add variable");
    await flushPromises();
    const keyInput = field(dialog, "Variable 2 name");
    keyInput.value = "PORT";
    keyInput.dispatchEvent(new Event("input"));
    const valueInput = field(dialog, "Variable 2 value");
    valueInput.value = "3000";
    valueInput.dispatchEvent(new Event("input"));
    await flushPromises();

    clickButton(dialog, "Save");
    await flushPromises();

    expect(updateCalls).toEqual([
      [
        "w1",
        "a1",
        {
          entries: [
            { key: "API_KEY", value: "abc" },
            { key: "PORT", value: "3000" },
          ],
        },
      ],
    ]);
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("removes a variable from the set", async () => {
    const { wrapper, updateCalls } = makeHarness({
      envFileRelative: ".env",
      exists: true,
      entries: [
        { key: "KEEP", value: "1" },
        { key: "DROP", value: "2" },
      ],
    });
    await flushPromises();
    const dialog = dialogElement();

    clickButton(dialog, "Remove variable 2");
    await flushPromises();
    clickButton(dialog, "Save");
    await flushPromises();

    expect(updateCalls).toEqual([
      ["w1", "a1", { entries: [{ key: "KEEP", value: "1" }] }],
    ]);
    wrapper.unmount();
  });

  it("blocks the save on an invalid or duplicate key", async () => {
    const { wrapper } = makeHarness({
      envFileRelative: ".env",
      exists: true,
      entries: [{ key: "GOOD", value: "1" }],
    });
    await flushPromises();
    const dialog = dialogElement();

    const saveButton = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Save",
    )!;

    const keyInput = field(dialog, "Variable 1 name");
    keyInput.value = "1BAD";
    keyInput.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(saveButton.disabled).toBe(true);

    keyInput.value = "GOOD";
    keyInput.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(saveButton.disabled).toBe(false);

    clickButton(dialog, "Add variable");
    await flushPromises();
    const dupInput = field(dialog, "Variable 2 name");
    dupInput.value = "GOOD";
    dupInput.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(saveButton.disabled).toBe(true);
    wrapper.unmount();
  });

  it("shows the create hint when the file does not exist yet", async () => {
    const { wrapper } = makeHarness({
      envFileRelative: ".env",
      exists: false,
      entries: [],
    });
    await flushPromises();
    expect(dialogElement().textContent).toContain(
      "No file yet — saving creates it.",
    );
    wrapper.unmount();
  });
});
