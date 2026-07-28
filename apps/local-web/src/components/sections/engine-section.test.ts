// The "Where Vynel runs" section: it lists provisioned engine installs, tells
// the user in plain language what a provisioning run is doing, and — outside
// the desktop shell — says switching is unavailable instead of pretending.

import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { ServerInstallResponse } from "@vynel/contracts/server-install/server-install-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import EngineSection from "./EngineSection.vue";

function makeInstall(overrides: Partial<ServerInstallResponse> = {}): ServerInstallResponse {
  return {
    id: "install-1",
    userId: "user-1",
    host: "vynel.example.com",
    port: 22,
    username: "dana",
    authKind: "password",
    hostKeyFingerprint: "abc=",
    status: "installed",
    step: null,
    errorMessage: null,
    installedVersion: "0.1.1",
    lastHealthyAt: "2026-07-28T09:00:00.000Z",
    createdAt: "2026-07-28T08:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
    ...overrides,
  };
}

function mountOptions(client: VynelClient) {
  return {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ] as [typeof VueQueryPlugin, unknown],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  };
}

function clientWith(installs: ServerInstallResponse[]): VynelClient {
  return { serverInstall: { list: async () => installs } } as unknown as VynelClient;
}

describe("EngineSection", () => {
  it("says Vynel runs on this computer when no server is configured", async () => {
    const wrapper = mount(EngineSection, mountOptions(clientWith([])));
    await flushPromises();
    expect(wrapper.find(".current-engine").text()).toContain("This computer");
    expect(wrapper.findAll(".row")).toHaveLength(0);
  });

  it("lists provisioned installs with their version", async () => {
    const wrapper = mount(EngineSection, mountOptions(clientWith([makeInstall()])));
    await flushPromises();
    const rows = wrapper.findAll(".row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toContain("dana@vynel.example.com");
    expect(rows[0]?.find(".status-line").text()).toContain("0.1.1");
  });

  it("narrates a provisioning run's current step in plain language", async () => {
    const wrapper = mount(
      EngineSection,
      mountOptions(clientWith([makeInstall({ status: "provisioning", step: "upload" })])),
    );
    await flushPromises();
    expect(wrapper.find(".status-line").text()).toContain("Sending Vynel's engine");
    // A run in flight offers neither switch nor forget — it isn't ready yet.
    expect(wrapper.find(".use-button").exists()).toBe(false);
    expect(wrapper.find(".remove-button").exists()).toBe(false);
  });

  it("surfaces a failed install's actionable message", async () => {
    const wrapper = mount(
      EngineSection,
      mountOptions(
        clientWith([
          makeInstall({
            status: "failed",
            step: "preflight",
            errorMessage: "This server uses a C library Vynel cannot run on yet.",
            installedVersion: null,
          }),
        ]),
      ),
    );
    await flushPromises();
    expect(wrapper.find(".status-line").text()).toContain("C library");
    expect(wrapper.find(".is-danger").exists()).toBe(true);
  });

  it("tells the user switching needs the desktop app when the shell is absent", async () => {
    const wrapper = mount(EngineSection, mountOptions(clientWith([makeInstall()])));
    await flushPromises();
    // No Tauri global in jsdom — the seam reports itself unavailable.
    expect(wrapper.find(".unavailable-note").exists()).toBe(true);
  });
});
