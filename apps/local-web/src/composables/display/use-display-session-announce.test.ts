// The room telling the user's other windows what conversation it is holding —
// what the display dock mirrors. Liveness and phase go out at once (they decide
// whether the dock is on screen at all); a caption, which grows a sentence at a
// time while speaking, is throttled to something a corner row can be read at.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import {
  useDisplaySessionAnnounce,
  type DisplaySessionAnnouncement,
} from "./use-display-session-announce.js";

let announced: DisplaySessionAnnouncement[];

function announcingClient(): VynelClient {
  return {
    voice: {
      setDisplaySession: async (announcement: DisplaySessionAnnouncement) => {
        announced.push(announcement);
        return { published: true };
      },
    },
  } as unknown as VynelClient;
}

function mountAnnounce(session: ReturnType<typeof ref<DisplaySessionAnnouncement>>) {
  const pinia = createPinia();
  const wrapper = mount(
    defineComponent({
      setup() {
        useDisplaySessionAnnounce(() => session.value as DisplaySessionAnnouncement);
        return () => h("div");
      },
    }),
    {
      global: {
        plugins: [pinia],
        provide: { [vynelClientKey as symbol]: announcingClient() },
      },
    },
  );
  return { wrapper, live: useLiveChannelStore() };
}

const IDLE: DisplaySessionAnnouncement = { live: false, phase: "idle", caption: "" };

beforeEach(() => {
  announced = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDisplaySessionAnnounce", () => {
  // A window that boots outside a conversation still has to say so: the dock
  // would otherwise sit waiting for a change that never comes.
  it("announces what it holds on mount, and every change of shape at once", async () => {
    const session = ref<DisplaySessionAnnouncement>(IDLE);
    const { wrapper } = mountAnnounce(session);
    expect(announced).toEqual([IDLE]);

    session.value = { live: true, phase: "listening", caption: "Listening…" };
    await wrapper.vm.$nextTick();
    session.value = { live: true, phase: "thinking", caption: "Thinking…" };
    await wrapper.vm.$nextTick();
    expect(announced).toEqual([
      IDLE,
      { live: true, phase: "listening", caption: "Listening…" },
      { live: true, phase: "thinking", caption: "Thinking…" },
    ]);
  });

  it("throttles a growing caption, and never drops the last one", async () => {
    const session = ref<DisplaySessionAnnouncement>(IDLE);
    const { wrapper } = mountAnnounce(session);
    session.value = { live: true, phase: "speaking", caption: "Two" };
    await wrapper.vm.$nextTick();
    expect(announced).toHaveLength(2);

    // The reply grows a clause at a time — far faster than a corner row reads.
    session.value = { live: true, phase: "speaking", caption: "Two builds" };
    await wrapper.vm.$nextTick();
    session.value = { live: true, phase: "speaking", caption: "Two builds are" };
    await wrapper.vm.$nextTick();
    session.value = { live: true, phase: "speaking", caption: "Two builds are green" };
    await wrapper.vm.$nextTick();
    expect(announced).toHaveLength(2);

    // The trailing edge is kept deliberately: the sentence the room finished on
    // is the one the dock must be left holding.
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(announced.at(-1)).toEqual({
      live: true,
      phase: "speaking",
      caption: "Two builds are green",
    });
    expect(announced).toHaveLength(3);
  });

  // Liveness decides whether the dock is on screen at all — it never waits out
  // a caption window.
  it("lets the end of a conversation jump the throttle", async () => {
    const session = ref<DisplaySessionAnnouncement>({
      live: true,
      phase: "speaking",
      caption: "Two",
    });
    const { wrapper } = mountAnnounce(session);
    session.value = { live: true, phase: "speaking", caption: "Two builds" };
    await wrapper.vm.$nextTick();
    expect(announced).toHaveLength(1);

    session.value = IDLE;
    await wrapper.vm.$nextTick();
    expect(announced.at(-1)).toEqual(IDLE);
  });

  it("says the conversation is over when the room goes away", async () => {
    const session = ref<DisplaySessionAnnouncement>({
      live: true,
      phase: "listening",
      caption: "Listening…",
    });
    const { wrapper } = mountAnnounce(session);
    wrapper.unmount();
    await flushPromises();
    expect(announced.at(-1)).toEqual(IDLE);
  });

  // A caption queued a moment before the room closed must never land AFTER the
  // retraction — the dock would mirror a conversation whose room is gone.
  it("never lets a queued caption outlive the room", async () => {
    const session = ref<DisplaySessionAnnouncement>({
      live: true,
      phase: "speaking",
      caption: "Two",
    });
    const { wrapper } = mountAnnounce(session);
    session.value = { live: true, phase: "speaking", caption: "Two builds" };
    await wrapper.vm.$nextTick();

    wrapper.unmount();
    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(announced.at(-1)).toEqual(IDLE);
  });

  // An engine restart empties the hub's memo, and nothing about the
  // conversation changed to announce it again — the same fix the Display
  // toggle carries, for the same reason.
  it("says it again when the socket comes back", async () => {
    const session = ref<DisplaySessionAnnouncement>({
      live: true,
      phase: "listening",
      caption: "Listening…",
    });
    const { wrapper, live } = mountAnnounce(session);
    expect(announced).toHaveLength(1);

    live.status = "reconnecting";
    await wrapper.vm.$nextTick();
    expect(announced).toHaveLength(1);

    live.status = "open";
    vi.advanceTimersByTime(250);
    await flushPromises();
    expect(announced).toEqual([
      { live: true, phase: "listening", caption: "Listening…" },
      { live: true, phase: "listening", caption: "Listening…" },
    ]);
  });
});
