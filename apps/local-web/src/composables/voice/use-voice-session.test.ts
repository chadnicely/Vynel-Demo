import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { VynelClient } from "@vynel/sdk";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_MODE,
  VOICE_TIER_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useVoiceSession } from "./use-voice-session.js";

// The reviewer-flagged handoff leak: a wake handed to a browser WITHOUT Web
// Speech (happy-dom here, Firefox in the wild) must still fire onEnded — that
// is what releases the daemon's handed-off state via POST /session/end. A
// start that can't begin is an ended session, not a silent no-op.

function mountVoiceSession(onEnded: () => void) {
  let session!: ReturnType<typeof useVoiceSession>;
  const Harness = defineComponent({
    setup() {
      session = useVoiceSession({ onEnded });
      return () => null;
    },
  });
  const wrapper = mount(Harness, {
    global: {
      // The failed-start path never reaches the client; a stub satisfies inject.
      provide: { [vynelClientKey as symbol]: {} as VynelClient },
    },
  });
  return { session, wrapper };
}

describe("useVoiceSession", () => {
  it("fires onEnded when a start cannot begin (no Web Speech in this browser)", () => {
    let endedCount = 0;
    const { session, wrapper } = mountVoiceSession(() => {
      endedCount += 1;
    });

    expect(session.canListen).toBe(false); // happy-dom ships no SpeechRecognition
    session.start();

    expect(endedCount).toBe(1);
    expect(session.failure.value).toContain("Chrome or Edge");
    expect(session.isActive.value).toBe(false);
    wrapper.unmount();
  });
});

// The overlay's real turn request + its barge-in lever, driven through a stub
// recognizer and scripted SSE bodies — no Web Speech, no network.
class SilentRecognizer {
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: unknown = null;
  onerror: unknown = null;
  onend: (() => void) | null = null;
  start(): void {}
  stop(): void {}
  abort(): void {}
}

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
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.unstubAllGlobals();
});

function mountWithStream() {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = SilentRecognizer;
  // The player synthesizes through the daemon TTS proxy — answer it here so the
  // test never opens a socket (a 503 = silent; the failure path is covered in
  // the player's own tests).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  const handles: ReturnType<typeof makeStreamHandle>[] = [];
  const POST = vi.fn(async (_path: string, init?: { signal?: AbortSignal }) => {
    const handle = makeStreamHandle();
    handles.push(handle);
    init?.signal?.addEventListener("abort", () => handle.abort());
    return { data: handle.stream, response: { ok: true, status: 200 } };
  });
  const interruptTurn = vi.fn(async () => ({ interrupted: true }));

  let session!: ReturnType<typeof useVoiceSession>;
  const Harness = defineComponent({
    setup() {
      session = useVoiceSession({ onEnded: () => {} });
      return () => null;
    },
  });
  wrapper = mount(Harness, {
    global: {
      provide: {
        [vynelClientKey as symbol]: { POST, root: { interruptTurn } } as unknown as VynelClient,
      },
    },
  });
  return { session, POST, interruptTurn, stream: () => handles[0]! };
}

describe("useVoiceSession — the overlay's turn request", () => {
  it("sends the voice tier: model, effort, hands-free mode, voice:true", async () => {
    const { session, POST } = mountWithStream();
    // An initial command runs the brain turn straight away (the wake phrase and
    // the request arrived in one breath) — no capture needed.
    session.start("what is on my calendar");
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());

    const [path, init] = POST.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(path).toBe("/root/turn");
    expect(init.body).toMatchObject({
      userMessageText: "what is on my calendar",
      model: VOICE_TIER_MODEL,
      thinkingEffort: VOICE_TIER_THINKING_EFFORT,
      mode: VOICE_TIER_MODE,
      voice: true,
    });
    session.end();
  });

  it("closing mid-reply interrupts the turn BY ITS SESSION ID (never the global head)", async () => {
    const { session, POST, interruptTurn, stream } = mountWithStream();
    session.start("read me the news");
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());
    // The stream names the spoken thread's segment, then the reply starts.
    stream().push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "voice-seg-7", role: "user", body: "read me the news" },
    });
    stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "Here is the first headline. " });
    await vi.waitFor(() => expect(session.view.value.state).toBe("speaking"));

    session.end();
    await vi.waitFor(() => expect(interruptTurn).toHaveBeenCalledWith({ sessionId: "voice-seg-7" }));
    expect(interruptTurn).not.toHaveBeenCalledWith({});
  });
});

describe("useVoiceSession — what the daemon link reads off it", () => {
  it("exposes the live turn's chat session id, and null around it", async () => {
    const { session, POST, stream } = mountWithStream();
    expect(session.currentSessionId()).toBeNull();
    session.start("read me the news");
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());
    stream().push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "voice-seg-7", role: "user", body: "read me the news" },
    });
    await vi.waitFor(() => expect(session.currentSessionId()).toBe("voice-seg-7"));
    session.end();
    // The cut turn settles → no turn in flight → nothing is "ours" any more.
    await vi.waitFor(() => expect(session.currentSessionId()).toBeNull());
  });

  it("takes a relayed line onto the live turn's own player; declines with no session or no turn", async () => {
    const { session, POST, stream } = mountWithStream();
    expect(session.speakExternal("nobody home")).toBe(false);
    session.start("read me the news");
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());
    stream().push("user-message-persisted", {
      kind: "user-message-persisted",
      message: { id: "u-1", sessionId: "voice-seg-7", role: "user", body: "read me the news" },
    });
    stream().push("text-chunk", { kind: "text-chunk", messageId: "m-1", textDelta: "First headline. " });
    await vi.waitFor(() => expect(session.view.value.state).toBe("speaking"));
    // A turn is in flight → the session queues it (synthesized through the same player).
    expect(session.speakExternal("Your build is green.")).toBe(true);
    const synthesize = fetch as unknown as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      const texts = synthesize.mock.calls.map(
        ([, init]) => JSON.parse((init as { body: string }).body).text as string,
      );
      expect(texts).toEqual(["First headline.", "Your build is green."]);
    });
    session.end();
    await vi.waitFor(() => expect(session.currentSessionId()).toBeNull());
    expect(session.speakExternal("too late")).toBe(false);
  });

  it("arms the wake's watchdog bound on the session — a silent turn says the honesty line through the player", async () => {
    const { session, POST } = mountWithStream();
    // A real (short) bound: the stream stays silent, so the line must be synthesized.
    session.start("do a long thing", 30);
    await vi.waitFor(() => expect(POST).toHaveBeenCalled());
    const synthesize = fetch as unknown as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      const texts = synthesize.mock.calls.map(
        ([, init]) => JSON.parse((init as { body: string }).body).text as string,
      );
      expect(texts).toContain("Still working on it — I'll say the answer when it lands.");
    });
    session.end();
  });
});
