import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { VynelClient } from "@vynel/sdk";
import WorkspaceSectionPanel from "../workspace/WorkspaceSectionPanel.vue";
import AppsSection from "./AppsSection.vue";

function makeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    userId: "u1",
    workspaceId: "w1",
    name: "Web app",
    command: "pnpm --filter web dev",
    cwdRelative: "",
    port: null,
    runtime: null,
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

function mountSection(client: VynelClient) {
  return mount(AppsSection, {
    props: { workspaceId: "w1" },
    ...mountOptions(client),
  });
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

async function typeInto(dialog: HTMLElement, label: string, text: string) {
  const field = dialog.querySelector<HTMLInputElement>(
    `[aria-label="${label}"]`,
  )!;
  field.value = text;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("AppsSection", () => {
  it("renders each app with its live status, browser link, and crash note", async () => {
    const client = {
      workspaceApps: {
        list: async () => [
          makeApp(),
          makeApp({
            id: "a2",
            name: "Api",
            command: "pnpm --filter api dev",
            cwdRelative: "apps/api",
            port: 5173,
            runtime: {
              status: "running",
              pid: 4242,
              startedAt: "2026-07-17T10:05:00.000Z",
              exitCode: null,
            },
          }),
          makeApp({
            id: "a3",
            name: "Worker",
            runtime: {
              status: "crashed",
              pid: null,
              startedAt: "2026-07-17T10:05:00.000Z",
              exitCode: 1,
            },
          }),
        ],
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.findAll(".row")).toHaveLength(3);
    // Never-ran reads as stopped; the live states get their own dots.
    expect(wrapper.find(".status-dot.is-stopped").exists()).toBe(true);
    expect(wrapper.find(".status-dot.is-running").exists()).toBe(true);
    expect(wrapper.find(".status-dot.is-crashed").exists()).toBe(true);

    // The running row: Stop is the affordance, and its port opens the browser.
    expect(wrapper.find('[aria-label="Stop Api"]').exists()).toBe(true);
    const link = wrapper.get(".browser-link");
    expect(link.attributes("href")).toBe("http://localhost:5173");
    expect(link.attributes("target")).toBe("_blank");

    // The crashed row explains itself; the command + folder read monospace.
    expect(wrapper.text()).toContain("stopped unexpectedly (code 1)");
    expect(wrapper.text()).toContain("pnpm --filter api dev · apps/api");
    expect(wrapper.find('[aria-label="Start Web app"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("starts a stopped app from its Start pill", async () => {
    const startCalls: unknown[] = [];
    const client = {
      workspaceApps: {
        list: async () => [makeApp()],
        start: async (workspaceId: string, appId: string) => {
          startCalls.push([workspaceId, appId]);
          return makeApp({
            runtime: {
              status: "running",
              pid: 4242,
              startedAt: "2026-07-17T10:05:00.000Z",
              exitCode: null,
            },
          });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Start Web app"]').trigger("click");
    await flushPromises();

    expect(startCalls).toEqual([["w1", "a1"]]);
    wrapper.unmount();
  });

  it("stops a running app from its Stop pill", async () => {
    const stopCalls: unknown[] = [];
    const client = {
      workspaceApps: {
        list: async () => [
          makeApp({
            runtime: {
              status: "running",
              pid: 4242,
              startedAt: "2026-07-17T10:05:00.000Z",
              exitCode: null,
            },
          }),
        ],
        stop: async (workspaceId: string, appId: string) => {
          stopCalls.push([workspaceId, appId]);
          return makeApp();
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Stop Web app"]').trigger("click");
    await flushPromises();

    expect(stopCalls).toEqual([["w1", "a1"]]);
    wrapper.unmount();
  });

  it("surfaces a failed start (409 already running) as one readable line", async () => {
    const client = {
      workspaceApps: {
        list: async () => [makeApp()],
        start: async () => {
          throw new Error("Web app is already running.");
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Start Web app"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "already running",
    );
    wrapper.unmount();
  });

  it("removes an app from its hover-reveal control", async () => {
    const removeCalls: unknown[] = [];
    const client = {
      workspaceApps: {
        list: async () => [makeApp()],
        remove: async (workspaceId: string, appId: string) => {
          removeCalls.push([workspaceId, appId]);
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    await wrapper.get('[aria-label="Remove Web app"]').trigger("click");
    await flushPromises();

    expect(removeCalls).toEqual([["w1", "a1"]]);
    wrapper.unmount();
  });

  it("unfolds the log tail behind the Logs disclosure", async () => {
    const logsCalls: unknown[] = [];
    const client = {
      workspaceApps: {
        list: async () => [makeApp()],
        logs: async (workspaceId: string, appId: string, query: unknown) => {
          logsCalls.push([workspaceId, appId, query]);
          return { lines: ["$ pnpm --filter web dev", "ready in 300ms"] };
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    // Collapsed by default — no log fetch until the user asks.
    expect(logsCalls).toEqual([]);

    await wrapper.get('[aria-label="Logs for Web app"]').trigger("click");
    await flushPromises();

    expect(logsCalls).toEqual([["w1", "a1", { tail: 200 }]]);
    expect(wrapper.get(".log-view").text()).toContain("ready in 300ms");
    wrapper.unmount();
  });

  it("adds an app through the dialog", async () => {
    const addCalls: unknown[] = [];
    const client = {
      workspaceApps: {
        list: async () => [],
        add: async (workspaceId: string, input: unknown) => {
          addCalls.push([workspaceId, input]);
          return makeApp({ id: "a9", name: "Web app" });
        },
      },
    } as unknown as VynelClient;

    const wrapper = mountSection(client);
    await flushPromises();

    expect(wrapper.text()).toContain("No apps yet");
    await wrapper.get(".invite-button").trigger("click");
    await flushPromises();

    const dialog = dialogElement();
    await typeInto(dialog, "App name", "Web app");
    await typeInto(dialog, "Start command", "npm run dev");

    const submit = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add app",
    )!;
    submit.click();
    await flushPromises();

    expect(addCalls).toEqual([
      ["w1", { name: "Web app", command: "npm run dev" }],
    ]);
    wrapper.unmount();
  });
});

describe("WorkspaceSectionPanel — apps gating", () => {
  function mountPanel(session: Record<string, unknown>) {
    const client = {
      hub: { getSession: async () => session },
      workspaceApps: { list: async () => [makeApp()] },
    } as unknown as VynelClient;
    return mount(WorkspaceSectionPanel, {
      props: { section: "apps" as const, workspaceId: "w1" },
      ...mountOptions(client),
    });
  }

  it("shows the Pro card in place of the section when 'apps' is locked", async () => {
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
    expect(wrapper.findComponent(AppsSection).exists()).toBe(false);
    wrapper.unmount();
  });

  it("hosts AppsSection once the entitlement includes 'apps'", async () => {
    const wrapper = mountPanel({
      kind: "signed-in",
      email: "chad@vynel.app",
      displayName: "Chad",
      checkedAt: "2026-07-17T09:00:00.000Z",
      tier: "pro",
      features: ["channels", "apps"],
    });
    await flushPromises();

    expect(wrapper.findComponent(AppsSection).exists()).toBe(true);
    expect(wrapper.text()).toContain("Web app");
    wrapper.unmount();
  });
});
