// Settings → Embedding: shows the one embedding model's state in plain words,
// downloads it on request, and never pretends about a failure.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import EmbeddingSection from "./EmbeddingSection.vue";

function embeddingModel(overrides: Partial<LocalModelStatusResponse> = {}): LocalModelStatusResponse {
  return {
    id: "minilm-l6-v2",
    kind: "embedding",
    label: "MiniLM L6 v2",
    description: "Turns your memory entries and knowledge files into vectors.",
    approxBytes: 23_000_000,
    speakers: null,
    state: "missing",
    installedAt: null,
    download: null,
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

function clientWith(models: LocalModelStatusResponse[], download = vi.fn(async () => models[0])) {
  const client = {
    localModels: {
      list: async () => ({ models }),
      download,
      cancelDownload: vi.fn(async () => ({ cancelled: true })),
      remove: vi.fn(async () => models[0]),
    },
  } as unknown as VynelClient;
  return { client, download };
}

describe("EmbeddingSection", () => {
  it("shows the model as not downloaded with the honest first-use note", async () => {
    const wrapper = mount(EmbeddingSection, mountOptions(clientWith([embeddingModel()]).client));
    await flushPromises();
    expect(wrapper.get('[data-testid="model-state"]').text()).toBe("Not downloaded");
    expect(wrapper.get(".usage-note").text()).toContain("download it now");
  });

  it("downloads on request through the client", async () => {
    const { client, download } = clientWith([embeddingModel()]);
    const wrapper = mount(EmbeddingSection, mountOptions(client));
    await flushPromises();
    await wrapper.get(".download-button").trigger("click");
    await flushPromises();
    expect(download).toHaveBeenCalledWith("minilm-l6-v2");
  });

  it("says it is ready once installed, and offers Remove", async () => {
    const wrapper = mount(
      EmbeddingSection,
      mountOptions(clientWith([embeddingModel({ state: "installed", installedAt: "2026-08-22T10:00:00Z" })]).client),
    );
    await flushPromises();
    expect(wrapper.get(".usage-note").text()).toContain("Ready");
    expect(wrapper.find(".remove-button").exists()).toBe(true);
  });

  it("surfaces a failed download with its message", async () => {
    const wrapper = mount(
      EmbeddingSection,
      mountOptions(
        clientWith([
          embeddingModel({
            state: "failed",
            download: { bytes: 0, total: null, error: "download failed (503)", startedAt: "x", finishedAt: "y" },
          }),
        ]).client,
      ),
    );
    await flushPromises();
    expect(wrapper.get(".state-detail").text()).toBe("download failed (503)");
    expect(wrapper.get(".download-button").text()).toContain("Try again");
  });
});
