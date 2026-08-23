// Settings → GitHub: three honest states (CLI missing, signed out, signed
// in), the in-app sign-in showing gh's own code + URL and noticing the
// verdict, and sign-out — over a fake client; the CLI is never spawned.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import GitHubSection from "./GitHubSection.vue";

type Status = {
  isInstalled: boolean;
  isAuthenticated: boolean;
  accountLabel: string | null;
  inactiveReason: string | null;
};

function clientWith(
  status: Status,
  signInPhases: string[] = ["awaiting-browser", "signed-in"],
) {
  let current = status;
  const phases = [...signInPhases];
  const calls = { signOut: 0, cancel: 0 };
  const client = {
    github: {
      getConnection: async () => current,
      beginSignIn: async () => ({
        loginId: "login-1",
        phase: phases.shift() ?? "failed",
        userCode: "ABCD-1234",
        verificationUrl: "https://github.com/login/device",
        errorMessage: null,
      }),
      getSignIn: async () => {
        const phase = phases.shift() ?? "signed-in";
        if (phase === "signed-in") {
          current = {
            isInstalled: true,
            isAuthenticated: true,
            accountLabel: "chadnicely",
            inactiveReason: null,
          };
        }
        return {
          loginId: "login-1",
          phase,
          userCode: "ABCD-1234",
          verificationUrl: "https://github.com/login/device",
          errorMessage:
            phase === "failed" ? "error: device code expired" : null,
        };
      },
      cancelSignIn: async () => {
        calls.cancel += 1;
      },
      signOut: async () => {
        calls.signOut += 1;
        current = {
          isInstalled: true,
          isAuthenticated: false,
          accountLabel: null,
          inactiveReason: "Not signed in",
        };
      },
    },
  } as unknown as VynelClient;
  return { client, calls };
}

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  vi.useRealTimers();
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountSection(client: VynelClient) {
  const wrapper = mount(GitHubSection, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ] as [typeof VueQueryPlugin, unknown],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  await flushPromises();
  activeWrapper = wrapper;
  return wrapper;
}

describe("GitHubSection", () => {
  it("says the CLI is missing and how to get it", async () => {
    const { client } = clientWith({
      isInstalled: false,
      isAuthenticated: false,
      accountLabel: null,
      inactiveReason: "The GitHub CLI (gh) is not installed",
    });
    const wrapper = await mountSection(client);
    expect(wrapper.text()).toContain("The GitHub CLI is not installed");
    expect(wrapper.text()).toContain("winget install GitHub.cli");
    expect(wrapper.find("button.sign-in").exists()).toBe(false);
  });

  it("shows who is signed in and signs out", async () => {
    const { client, calls } = clientWith({
      isInstalled: true,
      isAuthenticated: true,
      accountLabel: "chadnicely",
      inactiveReason: null,
    });
    const wrapper = await mountSection(client);
    expect(wrapper.text()).toContain("Signed in as @chadnicely");

    await wrapper.find("button.sign-out").trigger("click");
    await flushPromises();
    expect(calls.signOut).toBe(1);
    expect(wrapper.text()).toContain("Not signed in");
  });

  it("signs in with gh's own code + URL on screen, and notices the verdict", async () => {
    vi.useFakeTimers();
    const { client } = clientWith({
      isInstalled: true,
      isAuthenticated: false,
      accountLabel: null,
      inactiveReason: "Not signed in",
    });
    const wrapper = await mountSection(client);
    expect(wrapper.text()).toContain("Not signed in");

    await wrapper.find("button.sign-in").trigger("click");
    await flushPromises();
    expect(wrapper.find("code.user-code").text()).toBe("ABCD-1234");
    expect(wrapper.text()).toContain("https://github.com/login/device");
    expect(wrapper.text()).toContain("Waiting for you to approve it");

    await vi.advanceTimersByTimeAsync(1_600);
    await flushPromises();
    expect(wrapper.text()).toContain("Signed in as @chadnicely");
  });

  it("a failed sign-in says gh's reason and offers the button again", async () => {
    vi.useFakeTimers();
    const { client } = clientWith(
      {
        isInstalled: true,
        isAuthenticated: false,
        accountLabel: null,
        inactiveReason: "Not signed in",
      },
      ["awaiting-browser", "failed"],
    );
    const wrapper = await mountSection(client);
    await wrapper.find("button.sign-in").trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1_600);
    await flushPromises();

    expect(wrapper.text()).toContain("error: device code expired");
    expect(wrapper.find("button.sign-in").exists()).toBe(true);
  });
});
