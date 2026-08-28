import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayPresence from "./DisplayPresence.vue";
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

const base = { energy: 0.5, listening: false, speaking: false } as const;

describe("DisplayPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrbRenderer.mockReturnValue(orb);
  });

  it("draws the canvas orb, and only the orb, for kind 'orb'", () => {
    const wrapper = mount(DisplayPresence, { props: { kind: "orb", ...base } });

    expect(wrapper.find("canvas").exists()).toBe(true);
    expect(wrapper.find('[data-testid="display-presence-wave"]').exists()).toBe(
      false,
    );
  });

  it("passes the theme's form down to the orb", () => {
    mount(DisplayPresence, { props: { kind: "orb", ...base, form: "ribbon" } });

    expect(createOrbRenderer).toHaveBeenCalledWith(expect.anything(), {
      form: "ribbon",
    });
  });

  it("passes the theme's palette down to the orb", () => {
    const palette = { ...DEFAULT_ORB_PALETTE, wave: "7,7,7" };

    mount(DisplayPresence, { props: { kind: "orb", ...base, palette } });

    expect(createOrbRenderer).toHaveBeenCalledWith(expect.anything(), {
      palette,
    });
  });

  // The non-canvas stages are CSS, so they must not construct a renderer at
  // all — that is what makes them work on a machine with no 2D context.
  it.each(["wave"] as const)(
    "draws %s without touching the canvas renderer",
    (kind) => {
      const wrapper = mount(DisplayPresence, { props: { kind, ...base } });

      expect(
        wrapper.find(`[data-testid="display-presence-${kind}"]`).exists(),
      ).toBe(true);
      expect(wrapper.find("canvas").exists()).toBe(false);
      expect(createOrbRenderer).not.toHaveBeenCalled();
    },
  );

  it("marks the wave live while listening or speaking", () => {
    const wave = mount(DisplayPresence, {
      props: { kind: "wave", energy: 0.2, listening: false, speaking: true },
    });

    expect(
      wave.find('[data-testid="display-presence-wave"]').classes(),
    ).toContain("speaking");
  });

  it("swaps stage when the kind changes", async () => {
    const wrapper = mount(DisplayPresence, { props: { kind: "orb", ...base } });
    expect(wrapper.find("canvas").exists()).toBe(true);

    await wrapper.setProps({ kind: "wave" });

    expect(wrapper.find("canvas").exists()).toBe(false);
    expect(wrapper.find('[data-testid="display-presence-wave"]').exists()).toBe(
      true,
    );
    // Leaving the orb must not leak its animation frame.
    expect(orb.stop).toHaveBeenCalled();
  });

  it("forwards a renderer failure from the orb", () => {
    createOrbRenderer.mockImplementation(() => {
      throw new Error("no 2D context");
    });

    const wrapper = mount(DisplayPresence, { props: { kind: "orb", ...base } });

    expect(wrapper.emitted("renderer-failed")).toHaveLength(1);
  });
});
