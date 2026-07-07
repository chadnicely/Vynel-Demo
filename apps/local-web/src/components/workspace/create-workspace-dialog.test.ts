import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog.vue";

// A two-level fake filesystem: home (C:\Users\chad) with one subfolder.
function makeFakeClient() {
  const registerCalls: unknown[] = [];
  const listings: Record<
    string,
    { path: string; parent: string | null; entries: Array<{ name: string; path: string }>; drives: string[] }
  > = {
    home: {
      path: "C:\\Users\\chad",
      parent: "C:\\Users",
      entries: [{ name: "Projects", path: "C:\\Users\\chad\\Projects" }],
      drives: ["C:\\"],
    },
    "C:\\Users\\chad\\Projects": {
      path: "C:\\Users\\chad\\Projects",
      parent: "C:\\Users\\chad",
      entries: [],
      drives: ["C:\\"],
    },
  };

  const client = {
    workspaces: {
      listDirectories: async (options?: { path?: string }) =>
        listings[options?.path ?? "home"],
      register: async (input: { name: string; directory: string }) => {
        registerCalls.push(input);
        return {
          id: "ws-new",
          userId: "user-1",
          name: input.name,
          managerName: null,
          kind: "personal",
          path: input.directory,
          isArchived: false,
          continueEnabled: true,
          createdAt: "",
          updatedAt: "",
          lastAccessedAt: "",
        };
      },
    },
  } as unknown as VynelClient;

  return { client, registerCalls };
}

// The dialog Teleports into document.body — unmount + clear between tests so
// one test's dialog can't shadow the next one's queries.
let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog() {
  const fake = makeFakeClient();
  const wrapper = mount(CreateWorkspaceDialog, {
    props: { open: true },
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
      provide: { [vynelClientKey as symbol]: fake.client },
    },
  });
  await flushPromises();
  activeWrapper = wrapper;
  return { wrapper, ...fake };
}

// Teleport moves the dialog to document.body — assert against the body DOM.
function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("CreateWorkspaceDialog", () => {
  it("lists the home directory and navigates into a subfolder", async () => {
    await mountDialog();
    expect(bodyText()).toContain("C:\\Users\\chad");
    expect(bodyText()).toContain("Projects");

    const entry = [...document.body.querySelectorAll("button.entry")].find(
      (button) => button.textContent?.includes("Projects"),
    ) as HTMLButtonElement;
    entry.click();
    await flushPromises();

    expect(bodyText()).toContain(
      "No subfolders — this folder itself becomes the workspace.",
    );
  });

  it("registers the browsed folder under the typed name and emits created", async () => {
    const { wrapper, registerCalls } = await mountDialog();

    const nameInput = document.body.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    nameInput.value = "Projects room";
    nameInput.dispatchEvent(new Event("input"));
    await flushPromises();

    (
      [...document.body.querySelectorAll("button.entry")].find((button) =>
        button.textContent?.includes("Projects"),
      ) as HTMLButtonElement
    ).click();
    await flushPromises();

    (document.body.querySelector("button.create") as HTMLButtonElement).click();
    await flushPromises();

    expect(registerCalls).toEqual([
      { name: "Projects room", directory: "C:\\Users\\chad\\Projects" },
    ]);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("disables create until a name is typed", async () => {
    await mountDialog();
    const createButton = document.body.querySelector(
      "button.create",
    ) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });
});
