import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import LocalModelCard from "./LocalModelCard.vue";

function model(overrides: Partial<LocalModelStatusResponse> = {}): LocalModelStatusResponse {
  return {
    id: "piper-lessac",
    kind: "tts",
    label: "Piper (Lessac)",
    description: "A small single voice.",
    approxBytes: 61_000_000,
    speakers: null,
    state: "missing",
    installedAt: null,
    download: null,
    ...overrides,
  };
}

describe("LocalModelCard", () => {
  it("offers Download for a missing model and emits its id", async () => {
    const wrapper = mount(LocalModelCard, { props: { model: model() } });
    expect(wrapper.get('[data-testid="model-state"]').text()).toBe("Not downloaded");
    await wrapper.get(".download-button").trigger("click");
    expect(wrapper.emitted("download")).toEqual([["piper-lessac"]]);
    expect(wrapper.find(".remove-button").exists()).toBe(false);
  });

  it("shows the bar and a Cancel while downloading", async () => {
    const wrapper = mount(LocalModelCard, {
      props: {
        model: model({
          state: "downloading",
          download: { bytes: 30_500_000, total: 61_000_000, error: null, startedAt: "x", finishedAt: null },
        }),
      },
    });
    expect(wrapper.get('[role="progressbar"]').attributes("aria-valuenow")).toBe("50");
    await wrapper.get(".cancel-button").trigger("click");
    expect(wrapper.emitted("cancel")).toEqual([["piper-lessac"]]);
  });

  it("offers Remove only where the screen allows it, once installed", async () => {
    const installed = model({ state: "installed", installedAt: "2026-08-22T10:00:00Z" });
    expect(mount(LocalModelCard, { props: { model: installed } }).find(".remove-button").exists()).toBe(false);

    const wrapper = mount(LocalModelCard, { props: { model: installed, removable: true } });
    await wrapper.get(".remove-button").trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["piper-lessac"]]);
  });

  it("says Try again with the error after a failure, and waits while busy", () => {
    const wrapper = mount(LocalModelCard, {
      props: {
        model: model({
          state: "failed",
          download: { bytes: 0, total: null, error: "download failed (503)", startedAt: "x", finishedAt: "y" },
        }),
        busy: true,
      },
    });
    expect(wrapper.get(".download-button").text()).toContain("Try again");
    expect(wrapper.get(".download-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".state-detail").text()).toBe("download failed (503)");
  });
});
