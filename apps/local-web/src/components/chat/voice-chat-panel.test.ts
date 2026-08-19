// The Voice chat panel's SETTINGS ENVELOPE (session-hardening D2): the spoken
// thread runs one tier on every leg, so a typed message here must carry the
// same model / effort / hands-free mode a spoken one does, and the composer
// must neither offer a change nor write one. Before this, the panel handed the
// composer the voice segment's id: the chips PATCHed a row no voice turn ever
// reads, and a typed turn ran the CHAT mode while the spoken one ran the tier.
//
// Plus the voice-realtime half: a typed turn's streamed reply is SPOKEN here
// per sentence, and Stop works on a watched voice turn by its session id.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_MODE,
  VOICE_TIER_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useActivityStore } from "../../stores/activity-store.js";
import {
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import VoiceChatPanel from "./VoiceChatPanel.vue";

// The browser player synthesizes through the daemon — stub it: we only need to
// see which lines were asked to play, and when.
const played: string[] = [];
let playerCancels = 0;
vi.mock("../../composables/voice/spoken-audio-player.js", () => ({
  createSpokenAudioPlayer: () => ({
    play: async (text: string) => {
      played.push(text);
    },
    cancel: () => {
      playerCancels += 1;
    },
  }),
}));

// A stand-in for the real composer: it only has to record what the panel
// handed it and be able to fire a send / a Stop.
const ComposerStub = defineComponent({
  name: "AppComposer",
  props: {
    sessionId: { type: [String, null], default: undefined },
    settingsLocked: { type: Boolean, default: false },
    settingsLockedNote: { type: [String, null], default: null },
    settingsDefaults: { type: Object, default: undefined },
    streaming: { type: Boolean, default: false },
    placeholder: { type: String, default: undefined },
    destinationLabel: { type: [String, null], default: null },
  },
  emits: ["send", "interrupt"],
  setup: () => () => h("div", { class: "composer-stub" }),
});

function sseFrame(kind: string, payload: object): Uint8Array {
  return new TextEncoder().encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function makeStreamHandle() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    push: (kind: string, payload: object) => controller.enqueue(sseFrame(kind, payload)),
    close: () => controller.close(),
    abort: () => controller.error(new DOMException("aborted", "AbortError")),
  };
}

let wrapper: VueWrapper | null = null;
let restoreSocket: () => void;
beforeEach(() => {
  restoreSocket = installFakeLiveSocket();
  played.length = 0;
  playerCancels = 0;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  restoreSocket();
  vi.restoreAllMocks();
});

function mountPanel(options: { headSessionId?: string } = {}) {
  const handles: ReturnType<typeof makeStreamHandle>[] = [];
  const POST = vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
    const handle = makeStreamHandle();
    handles.push(handle);
    init?.signal?.addEventListener("abort", () => handle.abort());
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  const updateSettings = vi.fn(async () => ({
    sessionMode: null,
    selectedModel: null,
    thinkingEffort: null,
    autoBuildout: null,
  }));
  const interruptTurn = vi.fn(async () => ({ interrupted: true }));
  const client = {
    POST,
    chat: { interruptSession: vi.fn(async () => undefined) },
    approvals: { decide: vi.fn(async () => undefined) },
    sessions: {
      updateSettings,
      getSettings: vi.fn(async () => ({
        sessionMode: null,
        selectedModel: null,
        thinkingEffort: null,
        autoBuildout: null,
      })),
    },
    root: {
      interruptTurn,
      getVoiceTranscript: vi.fn(async () => ({
        messages: [],
        session:
          options.headSessionId === undefined
            ? null
            : { id: options.headSessionId, model: VOICE_TIER_MODEL },
        toolCallsByMessageId: {},
      })),
    },
  } as never;

  wrapper = mount(VoiceChatPanel, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
      stubs: {
        AppComposer: ComposerStub,
        ThreadStream: true,
        QueuedMessageChips: true,
        ThreadSkeleton: true,
        EmptyState: true,
        PresenceDot: true,
      },
    },
  });
  return {
    POST,
    updateSettings,
    interruptTurn,
    stream: () => handles[0]!,
    composer: () => wrapper!.findComponent(ComposerStub),
  };
}

describe("VoiceChatPanel — the hands-free settings envelope", () => {
  it("locks the composer and gives it NO session id, so nothing can PATCH the voice row", () => {
    const { updateSettings, composer } = mountPanel();
    expect(composer().props("settingsLocked")).toBe(true);
    // No session id ⇒ the composer never reads or writes the voice row.
    expect(composer().props("sessionId")).toBeUndefined();
    expect(composer().props("settingsLockedNote")).toContain("Hands-free");
    // The chips SHOW the tier (the surface defaults the composer renders).
    expect(composer().props("settingsDefaults")).toMatchObject({
      modelId: VOICE_TIER_MODEL,
      mode: VOICE_TIER_MODE,
      thinkingEffort: VOICE_TIER_THINKING_EFFORT,
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("a typed message carries the voice tier — model, effort, hands-free mode, voice:true", async () => {
    const { POST, updateSettings, composer } = mountPanel();
    // Whatever the composer emits, the panel sends the tier.
    composer().vm.$emit("send", "how is the build going", [], {
      modelId: "claude-opus-4-8",
      mode: "ask",
      thinkingEffort: "max",
      autoBuildout: true,
    });
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());

    const [path, init] = POST.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(path).toBe("/root/turn");
    expect(init.body).toMatchObject({
      userMessageText: "how is the build going",
      model: VOICE_TIER_MODEL,
      mode: VOICE_TIER_MODE,
      thinkingEffort: VOICE_TIER_THINKING_EFFORT,
      voice: true,
    });
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("recognises a running turn by scopeKind 'voice' — never by a global one", async () => {
    mountPanel();
    const activity = useActivityStore();
    // Let the (empty) transcript settle so the panel is past its skeleton and
    // the running-turn signal is the only thing left deciding what it shows.
    await vi.waitFor(() =>
      expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(true),
    );
    const baseTurn = {
      turnId: "t-1",
      workspaceId: null,
      sessionId: null,
      startedAt: "2026-08-19T00:00:00.000Z",
    };
    // A GLOBAL turn — even one the feed labels as voice-originated — is not
    // this thread: identity is the scope, never an origin label or an absence.
    activity.serverTurns = {
      "t-1": { ...baseTurn, scopeKind: "global", origin: "voice" },
    } as never;
    await wrapper!.vm.$nextTick();
    expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(true);

    activity.serverTurns = {
      "t-1": { ...baseTurn, scopeKind: "voice", origin: "voice" },
    } as never;
    await wrapper!.vm.$nextTick();
    // Its OWN turn is running — the panel stops claiming nothing was spoken.
    expect(wrapper!.findComponent({ name: "EmptyState" }).exists()).toBe(false);
  });
});

describe("VoiceChatPanel — the typed turn's voice (voice-realtime)", () => {
  it("speaks the streamed reply a sentence at a time — the first one before the stream ends", async () => {
    const { POST, stream, composer } = mountPanel();
    composer().vm.$emit("send", "what's the weather", [], {});
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());
    stream().push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "voice-seg-1", role: "user", body: "what's the weather" },
    });
    stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "It's 26 degrees " });
    stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "and clear. Get some " });
    await vi.waitFor(() => expect(played).toEqual(["It's 26 degrees and clear."]));
    // Still streaming — the first sentence already plays.
    expect(composer().props("streaming")).toBe(true);

    stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "rest." });
    stream().push("session-completed", { kind: "session-completed", sessionId: "voice-seg-1" });
    stream().push("turn-stream-ended", {});
    stream().close();
    await vi.waitFor(() => expect(played).toEqual(["It's 26 degrees and clear.", "Get some rest."]));
  });

  it("Stop on a WATCHED voice turn (the daemon's) interrupts by that turn's session id — and never speaks it", async () => {
    const { interruptTurn, composer } = mountPanel({ headSessionId: "voice-seg-1" });
    const activity = useActivityStore();
    // The feed says the spoken thread's turn is running on its segment …
    activity.applyServerActivity({
      kind: "turn-started",
      turnId: "turn-voice",
      scopeKind: "voice",
      workspaceId: null,
      sessionId: "voice-seg-1",
      origin: "voice",
      startedAt: "2026-08-19T00:00:00.000Z",
      primarySessionId: "voice-primary",
    } as never);
    // … and the window's live socket comes up and acks the standing watch
    // (opened once the transcript named the head), so the shared fold shows
    // the turn immediately (seeded from the rows).
    const socket = await vi.waitFor(() => latestFakeLiveSocket());
    socket.serverOpens();
    for (const message of socket.takeSent()) {
      if (message.op === "subscribe") socket.serverAcks(...message.channels);
    }
    socket.serverSends({
      kind: "event",
      channel: "session:voice-seg-1",
      event: { kind: "text-chunk", messageId: "m-live", textDelta: "Reading your schedule now. " },
    });
    await vi.waitFor(() => expect(composer().props("streaming")).toBe(true));

    composer().vm.$emit("interrupt");
    await vi.waitFor(() =>
      expect(interruptTurn).toHaveBeenCalledWith({ sessionId: "voice-seg-1" }),
    );
    expect(interruptTurn).not.toHaveBeenCalledWith({});
    // Not this window's turn — the overlay/daemon voices it, the panel stays quiet.
    expect(played).toEqual([]);
    expect(playerCancels).toBeGreaterThanOrEqual(1);
  });
});
