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

  // ONE meaning wherever the session lives (Kafi 2026-08-28): Stop ends the
  // voice conversation — never a hide that leaves a live microphone unseen.
  it("gives the row a Stop that stops listening, owned or mirrored", async () => {
    const owned = mountRow();
    const stop = owned.find("[data-testid='display-dock-stop']");
    expect(stop.attributes("aria-label")).toBe("Stop listening");
    expect(stop.text()).toBe("Stop");
    await stop.trigger("click");
    expect(owned.emitted("stop")).toHaveLength(1);

    // Mirrored, the button is the same button — the VIEW routes the stop to
    // the window that owns the session.
    const mirrored = mountRow({ isMirror: true });
    await mirrored.find("[data-testid='display-dock-stop']").trigger("click");
    expect(mirrored.emitted("stop")).toHaveLength(1);
  });
});
