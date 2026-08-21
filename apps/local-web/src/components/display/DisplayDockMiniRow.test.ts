// The corner row itself: its two ownerships (this window's conversation, or a
// mirror of the app window's) and the way out of it.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisplayDockMiniRow from "./DisplayDockMiniRow.vue";

function mountRow(props: Partial<InstanceType<typeof DisplayDockMiniRow>["$props"]> = {}) {
  return mount(DisplayDockMiniRow, {
    props: {
      orb: { energy: 0.5, listening: true, speaking: false },
      spikeKey: 0,
      caption: "Two builds are green",
      cards: [],
      micLabel: "Listening",
      isListening: true,
      ...props,
    },
  });
}

describe("DisplayDockMiniRow", () => {
  it("offers the mic as a switch for a conversation this window owns", async () => {
    const row = mountRow();
    const mic = row.find("[data-testid='display-dock-mic']");
    expect(mic.element.tagName).toBe("BUTTON");
    expect(mic.attributes("aria-pressed")).toBe("true");

    await mic.trigger("click");
    expect(row.emitted("toggleMute")).toHaveLength(1);
  });

  // A Web Speech session belongs to the window that opened it and cannot move
  // — a mic button here could only do nothing, or open a SECOND microphone
  // beside the one already listening in the room.
  it("reports the mic instead, mirrored", async () => {
    const row = mountRow({ isMirror: true, micLabel: "Muted", isListening: false });
    const mic = row.find("[data-testid='display-dock-mic']");
    expect(mic.element.tagName).toBe("SPAN");
    expect(mic.text()).toBe("Muted");

    await mic.trigger("click");
    expect(row.emitted("toggleMute")).toBeUndefined();
  });

  it("gives the row a way out, named for what it actually does", async () => {
    const owned = mountRow();
    const close = owned.find("[data-testid='display-dock-close']");
    expect(close.attributes("aria-label")).toBe("End the voice conversation");
    await close.trigger("click");
    expect(owned.emitted("close")).toHaveLength(1);

    // Mirrored, the X cannot end anything — the conversation is elsewhere.
    const mirrored = mountRow({ isMirror: true });
    expect(mirrored.find("[data-testid='display-dock-close']").attributes("aria-label")).toBe(
      "Hide the voice status",
    );
  });
});
