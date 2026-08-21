// The board's live half: the HTTP list seeds it, the per-user `display`
// channel patches it, and everything addressed to another scope is dropped.
// Driven with the fake socket + a fake SDK client — no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { DisplayLiveFrame } from "@vynel/contracts/display/display-live";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import {
  FakeLiveSocket,
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import {
  useDisplayWidgets,
  type DisplayBoardChange,
  type DisplayWidgets,
} from "./use-display-widgets.js";

function makeWidget(
  id: string,
  overrides: Partial<DisplayWidgetView> = {},
): DisplayWidgetView {
  return {
    id,
    scopeKey: "global",
    title: id,
    kind: "markdown",
    content: { kind: "markdown", body: `# ${id}` },
    slot: "stage",
    size: "md",
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

let restoreSocket: () => void;
let wrapper: VueWrapper | null = null;

type Read = DisplayWidgetView[] | Promise<DisplayWidgetView[]>;

/** Mounts the composable with the fake socket already open. `reads` is what
 *  each successive `listWidgets` call answers (a pending promise holds that
 *  read in flight). Returns before the socket is acked so a caller can act
 *  DURING the first read. */
function mountBoard(reads: Read[], scopeKey = "global") {
  const scope = ref(scopeKey);
  let read = 0;
  const listWidgets = vi.fn(async () => reads[Math.min(read++, reads.length - 1)]!);
  const clearWidgets = vi.fn(async () => ({ clearedCount: 1 }));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  // The frame tap the room's telemetry log rides — collected so a case can
  // read what the board SAID happened, not only what it now holds.
  const changes: DisplayBoardChange[] = [];
  let display!: DisplayWidgets;
  const Host = defineComponent({
    setup() {
      display = useDisplayWidgets(() => scope.value, {
        onChange: (change) => changes.push(change),
      });
      return () => h("div");
    },
  });
  wrapper = mount(Host, {
    global: {
      plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
      provide: {
        [vynelClientKey as symbol]: { display: { listWidgets, clear: clearWidgets } },
      },
    },
  });
  const socket = latestFakeLiveSocket();
  socket.serverOpens();
  const send = (event: DisplayLiveFrame) =>
    socket.serverSends({ kind: "event", channel: "display", event });
  return { display, socket, send, scope, listWidgets, clearWidgets, changes, invalidateQueries };
}

/** The common case: the board has loaded and the channel is acked. */
async function mountLoadedBoard(board: DisplayWidgetView[], scopeKey = "global") {
  const harness = mountBoard([board], scopeKey);
  harness.socket.serverAcks("display");
  await flushPromises();
  return harness;
}

beforeEach(() => {
  restoreSocket = installFakeLiveSocket();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  restoreSocket();
  vi.useRealTimers();
});

describe("useDisplayWidgets", () => {
  it("loads the scope's board, subscribes display, and buckets every slot by sortOrder", async () => {
    const { display, socket } = await mountLoadedBoard([
      makeWidget("second", { slot: "left", sortOrder: 2 }),
      makeWidget("first", { slot: "left", sortOrder: 1 }),
      makeWidget("staged", { slot: "stage", sortOrder: 5 }),
    ]);

    expect(socket.sent).toContainEqual({ op: "subscribe", channels: ["display"] });
    expect(display.isLoading.value).toBe(false);
    expect(display.widgets.value).toHaveLength(3);
    expect(display.bySlot.value.left.map((card) => card.id)).toEqual(["first", "second"]);
    expect(display.bySlot.value.stage.map((card) => card.id)).toEqual(["staged"]);
    // All four slots are always present — `dock` included, though DisplayView
    // only fills left|stage|right.
    expect(display.bySlot.value.right).toEqual([]);
    expect(display.bySlot.value.dock).toEqual([]);
  });

  it("patches the board on upserted / removed / cleared", async () => {
    const { display, send } = await mountLoadedBoard([makeWidget("w-1")]);

    send({ kind: "upserted", widget: makeWidget("w-2", { sortOrder: 2 }) });
    expect(display.bySlot.value.stage.map((card) => card.id)).toEqual(["w-1", "w-2"]);

    // An update REPLACES rather than appends, and re-sorts into place.
    send({ kind: "upserted", widget: makeWidget("w-2", { title: "Renamed", sortOrder: 0 }) });
    expect(display.bySlot.value.stage.map((card) => card.id)).toEqual(["w-2", "w-1"]);
    expect(display.widgets.value).toHaveLength(2);
    expect(display.widgets.value.find((card) => card.id === "w-2")?.title).toBe("Renamed");

    send({ kind: "removed", widgetId: "w-1", scopeKey: "global" });
    expect(display.widgets.value.map((card) => card.id)).toEqual(["w-2"]);

    send({ kind: "cleared", scopeKey: "global" });
    expect(display.widgets.value).toEqual([]);
  });

  it("leaves no ghost when an update moves a widget to another slot", async () => {
    const { display, send } = await mountLoadedBoard([makeWidget("w-1", { slot: "left" })]);

    send({ kind: "upserted", widget: makeWidget("w-1", { slot: "right" }) });

    expect(display.bySlot.value.left).toEqual([]);
    expect(display.bySlot.value.right.map((card) => card.id)).toEqual(["w-1"]);
  });

  it("ignores frames addressed to another scope — the channel is per user, not per scope", async () => {
    const { display, send } = await mountLoadedBoard([makeWidget("mine")], "global");

    send({ kind: "upserted", widget: makeWidget("theirs", { scopeKey: "ws-7" }) });
    send({ kind: "removed", widgetId: "mine", scopeKey: "ws-7" });
    send({ kind: "cleared", scopeKey: "ws-7" });

    expect(display.widgets.value.map((card) => card.id)).toEqual(["mine"]);
  });

  it("re-reads rather than dropping a frame that lands during the first read", async () => {
    const late = makeWidget("late");
    // The first read is issued BEFORE the widget is written, so it answers
    // without the card. Nothing on the board to patch when the frame lands.
    let answerFirstRead!: () => void;
    const inFlight = new Promise<DisplayWidgetView[]>((resolve) => {
      answerFirstRead = () => resolve([]);
    });
    const { display, send, listWidgets } = mountBoard([inFlight, [late]]);
    await flushPromises();
    expect(listWidgets).toHaveBeenCalledTimes(1);

    send({ kind: "upserted", widget: late });
    answerFirstRead();
    await flushPromises();

    // Swallowing the frame would leave the card off the board for good.
    expect(listWidgets).toHaveBeenCalledTimes(2);
    expect(display.widgets.value.map((card) => card.id)).toEqual(["late"]);
  });

  it("keeps re-reading until no frame has landed under a read in flight", async () => {
    // A read answers with the board as of when it was ISSUED and overwrites
    // any patch made meanwhile — so a frame arriving under the FOLLOW-UP read
    // has to earn a read of its own.
    const first = makeWidget("first");
    const second = makeWidget("second", { sortOrder: 2 });
    const answer: Array<() => void> = [];
    const held = (board: DisplayWidgetView[]) =>
      new Promise<DisplayWidgetView[]>((resolve) => answer.push(() => resolve(board)));
    const { display, send, listWidgets } = mountBoard([
      held([]),
      held([first]),
      [first, second],
    ]);
    await flushPromises();

    send({ kind: "upserted", widget: first }); // lands under read 1 → read 2
    answer[0]!();
    await flushPromises();
    expect(listWidgets).toHaveBeenCalledTimes(2);

    send({ kind: "upserted", widget: second }); // lands under read 2 → read 3
    answer[1]!();
    await flushPromises();

    expect(listWidgets).toHaveBeenCalledTimes(3);
    expect(display.widgets.value.map((card) => card.id)).toEqual(["first", "second"]);
  });

  it("re-reads the board after a reconnect — the frames in the gap are gone", async () => {
    vi.useFakeTimers();
    const { socket, invalidateQueries } = await mountLoadedBoard([makeWidget("w-1")]);
    invalidateQueries.mockClear();

    socket.serverDrops();
    expect(FakeLiveSocket.instances).toHaveLength(1); // the reconnect waits out the backoff
    vi.advanceTimersByTime(1_000);
    expect(FakeLiveSocket.instances).toHaveLength(2);

    const next = latestFakeLiveSocket();
    next.serverOpens("lc_2");
    expect(next.takeSent()).toEqual([{ op: "subscribe", channels: ["display"] }]);
    next.serverAcks("display");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["display-widgets"] });
  });

  it("names every change the frames made, telling an edit from an add", async () => {
    const { send, changes } = await mountLoadedBoard([
      makeWidget("w-1", { title: "This week" }),
    ]);

    send({ kind: "upserted", widget: makeWidget("w-2", { title: "Spend" }) });
    send({ kind: "upserted", widget: makeWidget("w-2", { title: "Spend so far" }) });
    send({ kind: "removed", widgetId: "w-1", scopeKey: "global" });
    send({ kind: "cleared", scopeKey: "global" });
    // Another board's frame is not this board's news.
    send({ kind: "cleared", scopeKey: "ws_other" });

    expect(changes).toEqual([
      { kind: "added", title: "Spend" },
      { kind: "updated", title: "Spend so far" },
      // Named from the board it was still on — a `removed` frame carries an id.
      { kind: "removed", title: "This week" },
      { kind: "cleared", title: null },
    ]);
  });

  it("clearOnServer blanks the board AND clears the scope on the server", async () => {
    const { display, clearWidgets } = await mountLoadedBoard([makeWidget("w-1")]);

    await display.clearOnServer();

    expect(display.widgets.value).toEqual([]);
    expect(clearWidgets).toHaveBeenCalledWith({ scope: "global" });
  });

  it("clearOnServer puts the board back when the POST failed", async () => {
    const { display, clearWidgets, invalidateQueries } = await mountLoadedBoard([
      makeWidget("w-1"),
    ]);
    clearWidgets.mockRejectedValueOnce(new Error("offline"));
    invalidateQueries.mockClear();

    await expect(display.clearOnServer()).rejects.toThrow("offline");

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["display-widgets", "global"],
    });
  });

  it("clear() blanks the board locally, and dispose releases the channel", async () => {
    const { display, socket } = await mountLoadedBoard([makeWidget("w-1")]);
    const live = useLiveChannelStore();

    display.clear();
    expect(display.widgets.value).toEqual([]);

    expect(live.channelCount()).toBe(1);
    wrapper!.unmount();
    wrapper = null;
    expect(live.channelCount()).toBe(0);
    expect(socket.takeSent().at(-1)).toEqual({ op: "unsubscribe", channels: ["display"] });
  });
});
