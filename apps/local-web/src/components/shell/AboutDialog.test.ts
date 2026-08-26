// About Vynel (2026-08-27): the version this computer runs and the one
// on-demand door into the gold update flow. The shell is faked through the
// same `window.__TAURI__` seam the composable reads — no Tauri npm dependency.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import AboutDialog from "./AboutDialog.vue";

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
  delete (window as { __TAURI__?: unknown }).__TAURI__;
});

function fakeShell(options: {
  version?: string;
  pending?: string | null;
  checkNow?: () => Promise<unknown>;
}): string[] {
  const invokes: string[] = [];
  (window as { __TAURI__?: unknown }).__TAURI__ = {
    event: { listen: () => Promise.resolve(() => {}) },
    core: {
      invoke: (command: string) => {
        invokes.push(command);
        if (command === "updater_pending_version") {
          return Promise.resolve(options.pending ?? null);
        }
        if (command === "updater_check_now" && options.checkNow) {
          return options.checkNow();
        }
        return Promise.resolve(null);
      },
    },
    app: { getVersion: () => Promise.resolve(options.version ?? "0.0.0") },
  };
  return invokes;
}

async function mountDialog() {
  const wrapper = mount(AboutDialog, { props: { open: true } });
  await flushPromises();
  activeWrapper = wrapper;
  return wrapper;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function findButton(test: string): HTMLButtonElement {
  const match = document.body.querySelector<HTMLButtonElement>(`[data-test="${test}"]`);
  if (!match) throw new Error(`no [data-test="${test}"] in the dialog`);
  return match;
}

describe("AboutDialog", () => {
  it("shows the shell's own version and offers the check", async () => {
    fakeShell({ version: "1.2.3" });
    await mountDialog();

    expect(bodyText()).toContain("Version 1.2.3");
    expect(findButton("about-check").textContent).toContain("Check for updates");
    expect(document.body.querySelector('[data-test="about-restart"]')).toBeNull();
  });

  it("a plain browser tab reads Development build, and says checks are unavailable", async () => {
    await mountDialog();

    expect(bodyText()).toContain("Development build");
    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("Updates aren't available in this build.");
  });

  it("a shell that cannot ever check (dev build) also answers unavailable", async () => {
    fakeShell({
      version: "1.2.3",
      checkNow: () => Promise.reject(new Error("updates are not available in this build")),
    });
    await mountDialog();

    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("Updates aren't available in this build.");
  });

  it("a check that comes back current says you're up to date", async () => {
    fakeShell({ version: "1.2.3", checkNow: () => Promise.resolve({ kind: "current" }) });
    await mountDialog();

    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("You're up to date.");
  });

  it("a transient miss says try again — never 'not in this build'", async () => {
    fakeShell({
      version: "1.2.3",
      checkNow: () => Promise.resolve({ kind: "failed", reason: "update check failed: offline" }),
    });
    await mountDialog();

    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("Couldn't check for updates — try again.");
    expect(bodyText()).not.toContain("Updates aren't available in this build.");
  });

  it("a check that finds an update swaps the block to the restart offer", async () => {
    fakeShell({
      version: "1.2.3",
      checkNow: () => Promise.resolve({ kind: "ready", version: "2.0.0" }),
    });
    await mountDialog();

    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("Version 2.0.0 is downloaded and ready.");
    expect(findButton("about-restart").textContent).toContain("Restart to update");
    expect(document.body.querySelector('[data-test="about-check"]')).toBeNull();
  });

  it("an already-downloaded update offers the pill's restart, and the click installs", async () => {
    const invokes = fakeShell({ version: "1.2.3", pending: "9.9.9" });
    await mountDialog();

    expect(bodyText()).toContain("Version 9.9.9 is downloaded and ready.");
    findButton("about-restart").click();
    await flushPromises();
    expect(invokes).toContain("updater_install_now");
    expect(findButton("about-restart").textContent).toContain("Restarting…");
  });

  it("reopening asks fresh — last visit's answer does not linger", async () => {
    fakeShell({ version: "1.2.3", checkNow: () => Promise.resolve({ kind: "current" }) });
    const wrapper = await mountDialog();

    findButton("about-check").click();
    await flushPromises();
    expect(bodyText()).toContain("You're up to date.");

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(bodyText()).not.toContain("You're up to date.");
  });
});
