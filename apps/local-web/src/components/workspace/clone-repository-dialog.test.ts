// "Create from a repository": the address names the workspace, the folder is
// the user's own pick, Clone it hands the registered row to the shell, and a
// failed clone says git's reason and stays.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { DirectoryListingResponse } from "@vynel/contracts/workspaces/workspace-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import CloneRepositoryDialog from "./CloneRepositoryDialog.vue";

const GIB = 1024 ** 3;
const PROJECTS = "C:\\Users\\chad\\Projects";

function makeFakeClient(options: { cloneFails?: boolean } = {}) {
  const cloneCalls: unknown[] = [];
  const rails = {
    drives: [
      {
        path: "C:\\",
        label: null,
        kind: "fixed" as const,
        freeBytes: 51 * GIB,
        totalBytes: 399 * GIB,
      },
    ],
    places: [{ kind: "home" as const, name: "chad", path: "C:\\Users\\chad" }],
  };
  const listings: Record<string, DirectoryListingResponse> = {
    "C:\\Users\\chad": {
      path: "C:\\Users\\chad",
      parent: "C:\\Users",
      entries: [{ name: "Projects", path: PROJECTS }],
      ...rails,
    },
    [PROJECTS]: {
      path: PROJECTS,
      parent: "C:\\Users\\chad",
      entries: [],
      ...rails,
    },
  };
  const client = {
    workspaces: {
      listDirectories: async (query?: { path?: string }) => {
        const listing = listings[query?.path ?? "C:\\Users\\chad"];
        if (!listing) throw new Error(`${query?.path} is not readable.`);
        return structuredClone(listing);
      },
      clone: async (input: { name: string; parentPath: string }) => {
        cloneCalls.push(input);
        if (options.cloneFails) {
          throw new Error(
            "Could not clone that repository — Authentication failed for the remote",
          );
        }
        return {
          workspace: {
            id: "ws-cloned",
            userId: "user-1",
            name: input.name,
            managerName: input.name,
            kind: "personal",
            path: `${input.parentPath}\\${input.name}`,
            isArchived: false,
            continueEnabled: true,
            groupId: null,
            status: null,
            statusNote: null,
            statusSetAt: null,
            createdAt: "",
            updatedAt: "",
            lastAccessedAt: "",
          },
        };
      },
    },
  } as unknown as VynelClient;
  return { client, cloneCalls };
}

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog(
  options: { cloneFails?: boolean; groupId?: string } = {},
) {
  const fake = makeFakeClient(options);
  const wrapper = mount(CloneRepositoryDialog, {
    props: { open: true, groupId: options.groupId ?? null },
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

function bodyText(): string {
  return document.body.textContent ?? "";
}

function tile(name: string): HTMLButtonElement {
  const match = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button.fs-tile"),
  ].find((button) => button.textContent?.trim() === name);
  if (!match) throw new Error(`no folder tile "${name}"`);
  return match;
}

async function type(selector: string, value: string) {
  const field = document.body.querySelector(selector) as HTMLInputElement;
  if (!field) throw new Error(`no field ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

function cloneButton(): HTMLButtonElement {
  return document.body.querySelector("button.clone") as HTMLButtonElement;
}

describe("CloneRepositoryDialog", () => {
  it("the address names the workspace, the folder is picked, Clone it registers the row", async () => {
    const { wrapper, cloneCalls } = await mountDialog({ groupId: "grp-1" });
    expect(bodyText()).toContain("Paste a repository address to continue");
    expect(cloneButton().disabled).toBe(true);

    await type(
      "input[placeholder='https://github.com/you/project.git']",
      "https://github.com/acme/pricing-tool.git",
    );
    expect(
      (document.body.querySelector("input.name") as HTMLInputElement).value,
    ).toBe("pricing-tool");
    expect(bodyText()).toContain("Pick the folder it will live in to continue");

    tile("Projects").click();
    await flushPromises();
    expect(bodyText()).toContain(`${PROJECTS}\\pricing-tool`);
    expect(cloneButton().disabled).toBe(false);

    cloneButton().click();
    await flushPromises();

    expect(cloneCalls).toEqual([
      {
        name: "pricing-tool",
        parentPath: PROJECTS,
        repositoryUrl: "https://github.com/acme/pricing-tool.git",
        groupId: "grp-1",
      },
    ]);
    const emitted = wrapper.emitted("created");
    expect(emitted).toHaveLength(1);
    expect((emitted![0]![0] as { id: string }).id).toBe("ws-cloned");
  });

  it("a failed clone says git's reason and stays open", async () => {
    const { wrapper } = await mountDialog({ cloneFails: true });
    await type(
      "input[placeholder='https://github.com/you/project.git']",
      "git@github.com:acme/private.git",
    );
    tile("Projects").click();
    await flushPromises();

    cloneButton().click();
    await flushPromises();

    expect(
      document.body.querySelector("[role='alert']")?.textContent,
    ).toContain("Authentication failed for the remote");
    expect(wrapper.emitted("created")).toBeUndefined();
    expect(bodyText()).toContain("Create from a repository");
  });
});
