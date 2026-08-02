import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { SdkError } from "@vynel/sdk";
import type { VynelClient } from "@vynel/sdk";
import WorkspaceSectionPanel from "../workspace/WorkspaceSectionPanel.vue";
import SshServersSection from "./SshServersSection.vue";
import type { SectionScope } from "./section-scope.js";

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv1",
    workspaceId: null,
    name: "My web server",
    host: "example.com",
    port: 22,
    username: "root",
    authKind: "password",
    hostKeyFingerprint: null,
    lastConnectedAt: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
    ...overrides,
  };
}

function mountOptions(client: VynelClient) {
  return {
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
  };
}

function mountSection(scope: SectionScope, client: VynelClient) {
  return mount(SshServersSection, {
    props: { scope },
    ...mountOptions(client),
  });
}

describe("SshServersSection", () => {
  // test: correct expectation for scope visibility — was "the global menu
  // shows every server", now "ONLY global (null-workspace) servers" per the
  // settled Global = workspaceId IS NULL rule (the channels convention).
  it("the global menu lists ONLY global servers, with the mono target and a Global chip", async () => {
    const client = {
      sshServers: {
        list: async () => [
          makeServer(),
          makeServer({
            id: "srv2",
            name: "Backup box",
            host: "staging.example.com",
            port: 2222,
            username: "deploy",
            lastConnectedAt: "2026-07-17T09:00:00.000Z",
          }),
          makeServer({ id: "srv3", workspaceId: "w1", name: "Room server" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(2);
    expect(wrapper.text()).toContain("root@example.com:22");
    expect(wrapper.text()).toContain("deploy@staging.example.com:2222");
    expect(wrapper.text()).not.toContain("Room server");
    // The chip marks the global rows; connection notes read as words.
    expect(wrapper.findAll(".scope-chip")).toHaveLength(2);
    expect(wrapper.text()).toContain("Never connected");
    // The relative wording depends on the wall clock — assert the stable part.
    expect(wrapper.text()).toContain("Last connected");
    wrapper.unmount();
  });

  it("shows a workspace only its own + global servers", async () => {
    const client = {
      sshServers: {
        list: async () => [
          makeServer(),
          makeServer({ id: "srv2", workspaceId: "w1", name: "Room server" }),
          makeServer({ id: "srv3", workspaceId: "OTHER", name: "Other box" }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(
      { kind: "workspace", workspaceId: "w1" },
      client,
    );
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(2);
    expect(wrapper.text()).toContain("Room server");
    expect(wrapper.text()).not.toContain("Other box");
    wrapper.unmount();
  });

  it("invites adding when there are no servers", async () => {
    const client = {
      sshServers: { list: async () => [] },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    expect(wrapper.text()).toContain("No servers yet");
    expect(wrapper.find(".invite-button").text()).toContain("Add a server");
    wrapper.unmount();
  });

  it("shows a quiet Connected check when the test passes", async () => {
    const testCalls: unknown[] = [];
    const client = {
      sshServers: {
        list: async () => [makeServer()],
        testConnection: async (serverId: string) => {
          testCalls.push(serverId);
          return { ok: true, hostKeyFingerprint: "SHA256:abc" };
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Test connection to My web server"]')
      .trigger("click");
    await flushPromises();

    expect(testCalls).toEqual(["srv1"]);
    expect(wrapper.get(".test-ok").text()).toContain("Connected");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("surfaces a failed test as the server's plain-language line", async () => {
    const client = {
      sshServers: {
        list: async () => [makeServer()],
        testConnection: async () => {
          throw new Error("The server didn't accept the password.");
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Test connection to My web server"]')
      .trigger("click");
    await flushPromises();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("didn't accept the password");
    expect(alert.classes()).toContain("is-danger");
    wrapper.unmount();
  });

  it("gives an identity change (409) its own warning tone", async () => {
    const client = {
      sshServers: {
        list: async () => [makeServer()],
        testConnection: async () => {
          throw new SdkError(new Response(null, { status: 409 }), {
            message: "This server's identity changed since you first connected.",
          });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper
      .get('[aria-label="Test connection to My web server"]')
      .trigger("click");
    await flushPromises();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("identity changed");
    expect(alert.classes()).toContain("is-warn");
    expect(alert.classes()).not.toContain("is-danger");
    wrapper.unmount();
  });

  it("removes only on the second, armed click (one click never deletes)", async () => {
    const removeCalls: unknown[] = [];
    const client = {
      sshServers: {
        list: async () => [makeServer()],
        remove: async (serverId: string) => {
          removeCalls.push(serverId);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    // First click only arms — the control flips to "Sure?" and nothing fires.
    await wrapper.get('[aria-label="Remove My web server"]').trigger("click");
    await flushPromises();
    expect(removeCalls).toEqual([]);

    const confirm = wrapper.get('[aria-label="Confirm remove My web server"]');
    expect(confirm.text()).toBe("Sure?");
    await confirm.trigger("click");
    await flushPromises();
    expect(removeCalls).toEqual(["srv1"]);
    wrapper.unmount();
  });

  it("disarms the remove confirm on blur instead of firing", async () => {
    const removeCalls: unknown[] = [];
    const client = {
      sshServers: {
        list: async () => [makeServer()],
        remove: async (serverId: string) => {
          removeCalls.push(serverId);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection({ kind: "global" }, client);
    await flushPromises();

    await wrapper.get('[aria-label="Remove My web server"]').trigger("click");
    await wrapper
      .get('[aria-label="Confirm remove My web server"]')
      .trigger("blur");
    await flushPromises();

    expect(removeCalls).toEqual([]);
    expect(
      wrapper.find('[aria-label="Remove My web server"]').exists(),
    ).toBe(true);
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — ssh gating", () => {
  function mountPanel(session: Record<string, unknown>) {
    const client = {
      hub: { getSession: async () => session },
      sshServers: { list: async () => [makeServer()] },
    } as unknown as VynelClient;
    return mount(WorkspaceSectionPanel, {
      props: { section: "ssh-servers" as const, workspaceId: "w1" },
      ...mountOptions(client),
    });
  }

  it("shows the Pro card in place of the section when 'ssh' is locked", async () => {
    const wrapper = mountPanel({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-17T09:00:00.000Z",
      tier: "basic",
      features: ["channels"],
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Part of Vynel Pro");
    expect(wrapper.findComponent(SshServersSection).exists()).toBe(false);
    wrapper.unmount();
  });

  it("hosts SshServersSection once the entitlement includes 'ssh'", async () => {
    const wrapper = mountPanel({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-17T09:00:00.000Z",
      tier: "pro",
      features: ["channels", "ssh"],
    });
    await flushPromises();

    expect(wrapper.findComponent(SshServersSection).exists()).toBe(true);
    expect(wrapper.text()).toContain("My web server");
    wrapper.unmount();
  });
});
