// The queued-send contract: busy sends queue, idle sends pass through, the
// queue drains one message per settle (view → null), and drain uses the
// CURRENT send (target re-derivation is the caller's job).

import { describe, expect, it, vi } from "vitest";
import { nextTick, shallowRef } from "vue";
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

function makeHarness() {
  const view = shallowRef<ActiveTurnView | null>(null);
  const send = vi.fn();
  const queuedSend = useQueuedSend(view, send);
  return { view, send, ...queuedSend };
}

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
})
