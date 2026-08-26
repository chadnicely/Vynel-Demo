// The queued-send contract: busy sends queue, idle sends pass through, the
// queue drains one message per settle (view → null), and drain uses the
// CURRENT send (target re-derivation is the caller's job).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h as createElement, nextTick, shallowRef } from "vue";
import type { ShallowRef } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { ActiveTurnView } from "./active-turn-view.js";
import { createActiveTurnView } from "./active-turn-view.js";
import { useQueuedSend } from "./use-queued-send.js";
import type { ComposerSettings } from "./use-session-settings.js";

// The settings ride every submit (captured at click time) and reach the send
// verbatim on drain.
const SETTINGS: ComposerSettings = {
  modelId: "claude-opus-4-8",
  mode: "ask",
  thinkingEffort: "high",
  autoBuildout: false,
};

function makeHarness(queueKey = "global") {
  const view = shallowRef<ActiveTurnView | null>(null);
  const send = vi.fn();
  const queuedSend = useQueuedSend(view, send, queueKey);
  return { view, send, ...queuedSend };
}

// The queue deliberately outlives components now, so it also outlives TESTS
// unless each one starts with a fresh store.
beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useQueuedSend", () => {
  it("passes through when idle, queues while a turn is in flight", () => {
    const h = makeHarness();
    h.submit("first", [], SETTINGS);
    expect(h.send).toHaveBeenCalledWith("first", [], SETTINGS);

    h.view.value = createActiveTurnView();
    h.submit("second", [], SETTINGS);
    h.submit("third", [], SETTINGS);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.queued.value.map((m) => m.text)).toEqual(["second", "third"]);
  });

  it("drains ONE message per settle — the next waits for its own turn to end", async () => {
    const h = makeHarness();
    h.view.value = createActiveTurnView();
    h.submit("a", [], SETTINGS);
    h.submit("b", [], SETTINGS);

    h.view.value = null; // the turn fully settled
    await nextTick();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenLastCalledWith("a", [], SETTINGS);
    expect(h.queued.value.map((m) => m.text)).toEqual(["b"]);

    h.view.value = createActiveTurnView(); // the drained send started a turn…
    await nextTick();
    h.view.value = null; // …which settled
    await nextTick();
    expect(h.send).toHaveBeenLastCalledWith("b", [], SETTINGS);
    expect(h.queued.value).toEqual([]);
  });

  it("does not drain while the view is merely completed-but-settling", async () => {
    const h = makeHarness();
    h.view.value = createActiveTurnView();
    h.submit("queued", [], SETTINGS);

    // Status flips off mid-settle, but the view is still mounted — no drain.
    h.view.value = { ...h.view.value!, status: "completed" };
    await nextTick();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("parks the queue after an interrupted or errored settle — Stop means stop", async () => {
    const h = makeHarness();
    h.view.value = createActiveTurnView();
    h.submit("parked", [], SETTINGS);

    h.view.value = { ...h.view.value!, status: "interrupted" };
    await nextTick();
    h.view.value = null; // the stopped turn settles
    await nextTick();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.queued.value.map((m) => m.text)).toEqual(["parked"]);

    // The next COMPLETED turn resumes the drain.
    h.view.value = createActiveTurnView();
    await nextTick();
    h.view.value = { ...h.view.value!, status: "completed" };
    await nextTick();
    h.view.value = null;
    await nextTick();
    expect(h.send).toHaveBeenCalledWith("parked", [], SETTINGS);
  });

  it("removeQueued drops a message before it fires", async () => {
    const h = makeHarness();
    h.view.value = createActiveTurnView();
    h.submit("keep", [], SETTINGS);
    h.submit("drop", [], SETTINGS);
    h.removeQueued(1);

    h.view.value = null;
    await nextTick();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith("keep", [], SETTINGS);
    expect(h.queued.value).toEqual([]);
  });

  // Chad, 2026-08-25: "whatever is added in the queue just disappears and the
  // AI never gets it". AppShell keys the RouterView by tab, so changing rooms
  // DESTROYS the chat view — a queue living in that component went with it.
  describe("surviving the component", () => {
    function mountRoom(
      view: ShallowRef<ActiveTurnView | null>,
      send: ReturnType<typeof vi.fn>,
      key: string,
    ) {
      const Room = defineComponent({
        setup() {
          useQueuedSend(view, send, key);
          return () => createElement("div");
        },
      });
      return mount(Room);
    }

    it("a queue outlives the view that took it", () => {
      const first = makeHarness("workspace:letterman");
      first.view.value = createActiveTurnView();
      first.submit("do the thing", [], SETTINGS);

      // The tab changed: that component is gone. A new one takes its place.
      const second = makeHarness("workspace:letterman");
      expect(second.queued.value.map((m) => m.text)).toEqual(["do the thing"]);
    });

    it("two rooms keep their own queues", () => {
      const letterman = makeHarness("workspace:letterman");
      const mintbird = makeHarness("workspace:mintbird");
      letterman.view.value = createActiveTurnView();
      mintbird.view.value = createActiveTurnView();

      letterman.submit("for letterman", [], SETTINGS);
      expect(mintbird.queued.value).toEqual([]);
    });

    // The turn ended while the user was in another room, so no component was
    // mounted to hear the transition. Without a drain on mount the message
    // waits forever — which reads exactly like the disappearance it fixes.
    it("drains on mount when the turn finished while we were away", async () => {
      const away = makeHarness("workspace:letterman");
      away.view.value = createActiveTurnView();
      away.submit("waiting for me", [], SETTINGS);

      const send = vi.fn();
      const view = shallowRef<ActiveTurnView | null>(null);
      const wrapper = mountRoom(view, send, "workspace:letterman");
      await nextTick();
      await nextTick();

      expect(send).toHaveBeenCalledWith("waiting for me", [], SETTINGS);
      wrapper.unmount();
    });

    it("a room still busy on return does NOT drain on mount", async () => {
      const away = makeHarness("workspace:letterman");
      away.view.value = createActiveTurnView();
      away.submit("still waiting", [], SETTINGS);

      const send = vi.fn();
      const view = shallowRef<ActiveTurnView | null>(createActiveTurnView());
      const wrapper = mountRoom(view, send, "workspace:letterman");
      await nextTick();
      await nextTick();

      expect(send).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    // A watched turn can land a tick after mount (the room's view derives from
    // a store that is still catching up). Firing into a busy room would put
    // the message in the wrong place — the mount drain waits a tick.
    it("a turn that shows up right after mount holds the drain", async () => {
      const away = makeHarness("workspace:letterman");
      away.view.value = createActiveTurnView();
      away.submit("not yet", [], SETTINGS);

      const send = vi.fn();
      const view = shallowRef<ActiveTurnView | null>(null);
      const wrapper = mountRoom(view, send, "workspace:letterman");
      view.value = createActiveTurnView(); // arrives before the tick
      await nextTick();
      await nextTick();

      expect(send).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });
});
