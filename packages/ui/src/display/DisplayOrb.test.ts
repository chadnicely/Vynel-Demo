import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayOrb from "./DisplayOrb.vue";

const orb = vi.hoisted(() => ({
  setEnergy: vi.fn(),
  setListening: vi.fn(),
  setSpeaking: vi.fn(),
  spike: vi.fn(),
  stop: vi.fn(),
}));
const createOrbRenderer = vi.hoisted(() => vi.fn());

vi.mock("./orb-renderer.js", () => ({ createOrbRenderer }));

describe("DisplayOrb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrbRenderer.mockReturnValue(orb);
  });

  it("starts one renderer on the canvas and seeds it with the props", () => {
    const wrapper = mount(DisplayOrb, {
      props: { energy: 0.4, listening: true, speaking: false },
    });

    expect(createOrbRenderer).toHaveBeenCalledTimes(1);
    expect(createOrbRenderer).toHaveBeenCalledWith(
      wrapper.find("canvas").element,
    );
    expect(orb.setEnergy).toHaveBeenCalledWith(0.4);
    expect(orb.setListening).toHaveBeenCalledWith(true);
    expect(orb.setSpeaking).toHaveBeenCalledWith(false);
  });

  it("pushes prop changes through to the renderer", async () => {
    const wrapper = mount(DisplayOrb, {
      props: { energy: 0, listening: false, speaking: false },
    });

    await wrapper.setProps({ energy: 1, listening: true, speaking: true });

    expect(orb.setEnergy).toHaveBeenLastCalledWith(1);
    expect(orb.setListening).toHaveBeenLastCalledWith(true);
    expect(orb.setSpeaking).toHaveBeenLastCalledWith(true);
  });

  it("spikes once per spikeKey change and never on the first render", async () => {
    const wrapper = mount(DisplayOrb, {
      props: { energy: 0, listening: false, speaking: true, spikeKey: 1 },
    });
    expect(orb.spike).not.toHaveBeenCalled();

    await wrapper.setProps({ spikeKey: 2 });
    await wrapper.setProps({ spikeKey: 2 });

    expect(orb.spike).toHaveBeenCalledTimes(1);
  });

  it("stops the renderer exactly once on unmount", () => {
    const wrapper = mount(DisplayOrb, {
      props: { energy: 0, listening: false, speaking: false },
    });

    wrapper.unmount();

    expect(orb.stop).toHaveBeenCalledTimes(1);
  });

  it("survives a renderer that cannot start", () => {
    createOrbRenderer.mockImplementation(() => {
      throw new Error("canvas 2D context unavailable");
    });

    const wrapper = mount(DisplayOrb, {
      props: { energy: 0, listening: false, speaking: false },
    });

    expect(wrapper.find("canvas").exists()).toBe(true);
    // The owner hears about the blank stage; the primitive itself stays quiet.
    expect(wrapper.emitted("renderer-failed")).toHaveLength(1);
    expect(() => wrapper.unmount()).not.toThrow();
    expect(orb.stop).not.toHaveBeenCalled();
  });
});
