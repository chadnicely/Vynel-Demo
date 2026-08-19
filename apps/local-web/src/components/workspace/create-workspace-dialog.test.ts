import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { DirectoryListingResponse } from "@vynel/contracts/workspaces/workspace-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog.vue";

const GIB = 1024 ** 3;

// A three-level fake filesystem: home (C:\Users\chad) → Projects → Bookkeeping.
function makeFakeClient() {
  const registerCalls: unknown[] = [];
  const createDirectoryCalls: unknown[] = [];
  const createGroupCalls: unknown[] = [];
  const groups = [{ id: "grp-1", name: "Clients" }];
  const rails = {
    drives: [
      { path: "C:\\", label: null, kind: "fixed" as const, freeBytes: 51.2 * GIB, totalBytes: 399 * GIB },
      { path: "E:\\", label: "WORKSPACE", kind: "fixed" as const, freeBytes: 51.1 * GIB, totalBytes: 199 * GIB },
    ],
    places: [
      { kind: "home" as const, name: "chad", path: "C:\\Users\\chad" },
      { kind: "desktop" as const, name: "Desktop", path: "C:\\Users\\chad\\Desktop" },
    ],
  };
  const listings: Record<string, DirectoryListingResponse> = {
    "C:\\Users\\chad": {
      path: "C:\\Users\\chad",
      parent: "C:\\Users",
      entries: [
        { name: "Desktop", path: "C:\\Users\\chad\\Desktop" },
        { name: "Projects", path: "C:\\Users\\chad\\Projects" },
      ],
      ...rails,
    },
    "C:\\Users\\chad\\Projects": {
      path: "C:\\Users\\chad\\Projects",
      parent: "C:\\Users\\chad",
      entries: [{ name: "Bookkeeping", path: "C:\\Users\\chad\\Projects\\Bookkeeping" }],
      ...rails,
    },
    "C:\\Users\\chad\\Projects\\Bookkeeping": {
      path: "C:\\Users\\chad\\Projects\\Bookkeeping",
      parent: "C:\\Users\\chad\\Projects",
      entries: [],
      ...rails,
    },
    "C:\\Users\\chad\\Desktop": {
      path: "C:\\Users\\chad\\Desktop",
      parent: "C:\\Users\\chad",
      entries: [],
      ...rails,
    },
  };

  const client = {
    workspaces: {
      // A fresh object per read, like the wire — vue-query compares by value.
      // A path the fake tree doesn't know is "not readable" (the API's 400).
      listDirectories: async (options?: { path?: string }) => {
        const listing = listings[options?.path ?? "C:\\Users\\chad"];
        if (!listing) throw new Error(`${options?.path} is not readable.`);
        return structuredClone(listing);
      },
      // Makes the folder in the fake tree so the re-list shows it.
      createDirectory: async (input: { parentPath: string; name: string }) => {
        createDirectoryCalls.push(input);
        const created = { name: input.name, path: `${input.parentPath}\\${input.name}` };
        listings[input.parentPath]!.entries.push(created);
        listings[created.path] = { path: created.path, parent: input.parentPath, entries: [], ...rails };
        return created;
      },
      listGroups: async () => structuredClone(groups),
      createGroup: async (input: { name: string }) => {
        createGroupCalls.push(input);
        const group = { id: `grp-${groups.length + 1}`, name: input.name };
        groups.push(group);
        return group;
      },
      register: async (input: { name: string; directory: string; groupId?: string }) => {
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

  return { client, registerCalls, createDirectoryCalls, createGroupCalls };
}

// The dialog Teleports into document.body — unmount + clear between tests so
// one test's dialog can't shadow the next one's queries.
let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog(props: { defaultGroupId?: string | null } = {}) {
  const fake = makeFakeClient();
  const wrapper = mount(CreateWorkspaceDialog, {
    props: { open: true, ...props },
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

function tile(name: string): HTMLButtonElement {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button.fs-tile")].find(
    (button) => button.textContent?.trim() === name,
  )!;
}

function nameInput(): HTMLInputElement {
  return document.body.querySelector("input[type='text']") as HTMLInputElement;
}

function continueButton(): HTMLButtonElement {
  return document.body.querySelector("button.create") as HTMLButtonElement;
}

describe("CreateWorkspaceDialog", () => {
  it("opens at Home with the Explorer rails: places, This PC, named drives, crumbs", async () => {
    await mountDialog();

    expect(tile("Projects")).toBeDefined();
    expect(bodyText()).toContain("This PC");
    expect(bodyText()).toContain("Local Disk (C:)");
    expect(bodyText()).toContain("WORKSPACE (E:)");
    // The address crumbs read the drive by its Explorer name, then the folders.
    const crumbs = [...document.body.querySelectorAll("button.fs-crumb")].map((b) =>
      b.textContent?.trim(),
    );
    expect(crumbs).toEqual(["This PC", "Local Disk (C:)", "Users", "chad"]);
  });

  it("won't continue on the home folder itself — a workspace is a room, not the house", async () => {
    await mountDialog();
    expect(continueButton().disabled).toBe(true);
    expect(bodyText()).toContain("whole home folder");
  });

  it("clicking a folder picks it and auto-fills the name; Continue registers it", async () => {
    const { wrapper, registerCalls } = await mountDialog();

    tile("Projects").click();
    await flushPromises();

    expect(nameInput().value).toBe("Projects");
    expect(continueButton().disabled).toBe(false);

    continueButton().click();
    await flushPromises();

    expect(registerCalls).toEqual([
      { name: "Projects", directory: "C:\\Users\\chad\\Projects" },
    ]);
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("double-clicking opens the folder; the open folder becomes the pick and names itself", async () => {
    await mountDialog();

    tile("Projects").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();

    expect(tile("Bookkeeping")).toBeDefined();
    expect(nameInput().value).toBe("Projects");

    tile("Bookkeeping").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();

    expect(bodyText()).toContain("Nothing inside");
    expect(nameInput().value).toBe("Bookkeeping");
    expect(continueButton().disabled).toBe(false);
  });

  it("a typed name stays put when the folder changes; clearing it follows the folder again", async () => {
    await mountDialog();

    const input = nameInput();
    input.value = "Money stuff";
    input.dispatchEvent(new Event("input"));
    await flushPromises();

    tile("Projects").click();
    await flushPromises();
    expect(nameInput().value).toBe("Money stuff");

    input.value = "";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(nameInput().value).toBe("Projects");
  });

  it("This PC shows every drive as a card with its free space, and Back returns", async () => {
    await mountDialog();

    (document.body.querySelector("button.fs-this-pc") as HTMLButtonElement).click();
    await flushPromises();

    expect(bodyText()).toContain("Devices and drives");
    expect(bodyText()).toContain("51.2 GB free of 399 GB");
    expect(bodyText()).toContain("51.1 GB free of 199 GB");
    // No folder is open, so nothing can be picked from here.
    expect(continueButton().disabled).toBe(true);

    (document.body.querySelector("button.fs-back") as HTMLButtonElement).click();
    await flushPromises();
    expect(tile("Projects")).toBeDefined();
  });

  it("New folder makes the folder here, re-lists, and picks it — the name follows", async () => {
    const { createDirectoryCalls } = await mountDialog();

    (document.body.querySelector("button.fs-new-folder") as HTMLButtonElement).click();
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>(".fs-new-folder-row input")!;
    expect(input.value).toBe("New folder");

    input.value = "Taxes 2026";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    (document.body.querySelector("button.fs-new-folder-create") as HTMLButtonElement).click();
    await flushPromises();
    await flushPromises();

    expect(createDirectoryCalls).toEqual([{ parentPath: "C:\\Users\\chad", name: "Taxes 2026" }]);
    expect(document.body.querySelector(".fs-new-folder-row")).toBeNull();
    expect(tile("Taxes 2026")).toBeDefined();
    expect(tile("Taxes 2026").getAttribute("aria-pressed")).toBe("true");
    expect(nameInput().value).toBe("Taxes 2026");
    expect(continueButton().disabled).toBe(false);
  });

  it("New folder is unavailable on This PC — there is no folder to create inside", async () => {
    await mountDialog();
    (document.body.querySelector("button.fs-this-pc") as HTMLButtonElement).click();
    await flushPromises();
    expect((document.body.querySelector("button.fs-new-folder") as HTMLButtonElement).disabled).toBe(true);
  });

  it("an unreadable folder shows why and steps back, rails intact", async () => {
    await mountDialog();
    // Plant an entry whose listing will fail.
    tile("Projects").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();
    const rail = document.body.querySelector("nav.fs-rail")!;
    expect(rail.textContent).toContain("WORKSPACE (E:)");

    // Fake a locked subfolder by navigating to a path the fake can't list.
    const upButton = document.body.querySelector("button.fs-up") as HTMLButtonElement;
    expect(upButton.disabled).toBe(false);
    (document.body.querySelector("button.fs-drive-nav") as HTMLButtonElement).click();
    await flushPromises();
    await flushPromises();

    // The drive root isn't in the fake tree → the API "refused" it: the message
    // shows, the browser is back in Projects, and the rails still paint.
    expect(document.body.querySelector(".fs-navigation-error")?.textContent).toContain(
      "not readable",
    );
    expect(tile("Bookkeeping")).toBeDefined();
    expect(rail.textContent).toContain("WORKSPACE (E:)");
    expect(nameInput().value).toBe("Projects");
  });

  it("a group's + pre-files the new workspace into that group", async () => {
    const { registerCalls } = await mountDialog({ defaultGroupId: "grp-1" });
    const select = document.body.querySelector<HTMLSelectElement>("select.group-select")!;
    expect(select.value).toBe("grp-1");

    tile("Projects").click();
    await flushPromises();
    continueButton().click();
    await flushPromises();

    expect(registerCalls).toEqual([
      { name: "Projects", directory: "C:\\Users\\chad\\Projects", groupId: "grp-1" },
    ]);
  });

  it("New group… makes the group right there and files the workspace into it", async () => {
    const { registerCalls, createGroupCalls } = await mountDialog();
    const select = document.body.querySelector<HTMLSelectElement>("select.group-select")!;
    expect(select.value).toBe("");

    select.value = "__new__";
    select.dispatchEvent(new Event("change"));
    await flushPromises();
    const nameField = document.body.querySelector<HTMLInputElement>("input.new-group-name")!;
    nameField.value = "Side projects";
    nameField.dispatchEvent(new Event("input"));
    await flushPromises();
    (document.body.querySelector("button.new-group-create") as HTMLButtonElement).click();
    await flushPromises();
    await flushPromises();

    expect(createGroupCalls).toEqual([{ name: "Side projects" }]);
    expect(document.body.querySelector("input.new-group-name")).toBeNull();
    expect(document.body.querySelector<HTMLSelectElement>("select.group-select")!.value).toBe("grp-2");

    tile("Projects").click();
    await flushPromises();
    continueButton().click();
    await flushPromises();
    expect(registerCalls).toEqual([
      { name: "Projects", directory: "C:\\Users\\chad\\Projects", groupId: "grp-2" },
    ]);
  });

  it("the rail's places jump straight to that folder", async () => {
    await mountDialog();

    [...document.body.querySelectorAll<HTMLButtonElement>("button.fs-place")]
      .find((button) => button.textContent?.trim() === "Desktop")!
      .click();
    await flushPromises();

    expect(nameInput().value).toBe("Desktop");
    const crumbs = [...document.body.querySelectorAll("button.fs-crumb")].map((b) =>
      b.textContent?.trim(),
    );
    expect(crumbs).toEqual(["This PC", "Local Disk (C:)", "Users", "chad", "Desktop"]);
  });
});
