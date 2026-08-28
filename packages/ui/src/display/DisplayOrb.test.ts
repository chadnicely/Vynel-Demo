import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayOrb from "./DisplayOrb.vue";
import { DEFAULT_ORB_PALETTE } from "./orb-palette.js";

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
    // No palette prop = empty options, which is the renderer's own "use the
    // default palette" path — the orb never names a palette it wasn't given.
    expect(createOrbRenderer).toHaveBeenCalledWith(
      wrapper.find("canvas").element,
      {},
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

  it("hands a supplied palette to the renderer", () => {
    const palette = { ...DEFAULT_ORB_PALETTE, wave: "1,2,3" };

    const wrapper = mount(DisplayOrb, {
      props: { energy: 0, listening: false, speaking: false, palette },
    });

    expect(createOrbRenderer).toHaveBeenCalledWith(
      wrapper.find("canvas").element,
      { palette },
    );
  });

  // The mote sprites are baked from the palette at construction, so restyling
  // in place would keep the OLD tints — a theme switch has to rebuild.
  it("rebuilds the renderer when the palette changes, stopping the old one", async () => {
    const wrapper = mount(DisplayOrb, {
      props: {
        energy: 0,
        listening: false,
        speaking: false,
        palette: DEFAULT_ORB_PALETTE,
      },
    });
    expect(createOrbRenderer).toHaveBeenCalledTimes(1);

    const next = { ...DEFAULT_ORB_PALETTE, wave: "9,9,9" };
    await wrapper.setProps({ palette: next });

    expect(orb.stop).toHaveBeenCalledTimes(1);
    expect(createOrbRenderer).toHaveBeenCalledTimes(2);
    expect(createOrbRenderer).toHaveBeenLastCalledWith(
      wrapper.find("canvas").element,
      { palette: next },
    );
  });

  // A rebuild must not lose where the conversation already was.
  it("seeds the rebuilt renderer with the live state", async () => {
    const wrapper = mount(DisplayOrb, {
      props: {
        energy: 0.7,
        listening: true,
        speaking: true,
        palette: DEFAULT_ORB_PALETTE,
      },
    });
    orb.setEnergy.mockClear();

    await wrapper.setProps({
      palette: { ...DEFAULT_ORB_PALETTE, wave: "4,4,4" },
    });

    expect(orb.setEnergy).toHaveBeenCalledWith(0.7);
    expect(orb.setListening).toHaveBeenLastCalledWith(true);
    expect(orb.setSpeaking).toHaveBeenLastCalledWith(true);
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
