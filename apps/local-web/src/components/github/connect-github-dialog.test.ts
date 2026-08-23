// "Connect to GitHub" on an existing workspace: signed out says so with the
// way to Settings (never a dead button); signed in seeds the name from the
// folder and runs ONE create-and-push for THIS workspace; gh's refusal is an
// outcome on screen, the dialog stays.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import ConnectGitHubDialog from "./ConnectGitHubDialog.vue";

function makeFakeClient(options: { signedIn: boolean; fails?: boolean }) {
  const calls: unknown[] = [];
  const client = {
    github: {
      getConnection: async () => ({
        isInstalled: true,
        isAuthenticated: options.signedIn,
        accountLabel: options.signedIn ? "kafijunior" : null,
        inactiveReason: options.signedIn ? null : "Not signed in",
      }),
    },
    workspaces: {
      createGitHubRepository: async (
        workspaceId: string,
        input: { name: string; visibility: string },
      ) => {
        calls.push({ workspaceId, ...input });
        return {
          outcome: options.fails
            ? { kind: "failed", reason: "Name already exists on this account." }
            : {
                kind: "created",
                url: `https://github.com/kafijunior/${input.name}`,
              },
        };
      },
    },
  } as unknown as VynelClient;
  return { client, calls };
}

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog(options: { signedIn: boolean; fails?: boolean }) {
  const fake = makeFakeClient(options);
  const wrapper = mount(ConnectGitHubDialog, {
    props: {
      open: true,
      workspaceId: "ws-7",
      workspacePath: "E:\\work\\Front of House",
    },
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

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button "${label}"`);
  return match;
}

describe("ConnectGitHubDialog", () => {
  it("signed out: says so, offers Settings, never the create button", async () => {
    const { wrapper, calls } = await mountDialog({ signedIn: false });
    expect(bodyText()).toContain("GitHub — not signed in");
    expect(document.body.querySelector("button.connect")).toBeNull();

    button("Open Settings").click();
    await flushPromises();
    expect(wrapper.emitted("openSettings")).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it("signed in: the name follows the folder, Create and push runs once for this workspace, Done closes", async () => {
    const { wrapper, calls } = await mountDialog({ signedIn: true });
    expect(bodyText()).toContain("Signed in as @kafijunior");
    const name = document.body.querySelector(
      'input[placeholder="my-workspace"]',
    ) as HTMLInputElement;
    expect(name.value).toBe("front-of-house");

    const publicChoice = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((choice) => choice.textContent?.includes("Public"));
    publicChoice!.click();
    await flushPromises();
    expect(publicChoice!.getAttribute("aria-checked")).toBe("true");
    button("Create and push").click();
    await flushPromises();

    expect(calls).toEqual([
      { workspaceId: "ws-7", name: "front-of-house", visibility: "public" },
    ]);
    expect(bodyText()).toContain(
      "https://github.com/kafijunior/front-of-house",
    );

    button("Done").click();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("gh's refusal is an outcome on screen; the dialog stays for a retry", async () => {
    const { wrapper } = await mountDialog({ signedIn: true, fails: true });
    button("Create and push").click();
    await flushPromises();

    expect(bodyText()).toContain("Name already exists on this account.");
    expect(document.body.querySelector("button.connect")).not.toBeNull();
    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
