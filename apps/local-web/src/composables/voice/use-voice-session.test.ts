import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
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

// The VOICE TIER on every leg (session-hardening D2): the overlay leg used to
// send the model and the effort but no MODE, so a spoken turn resolved the
// chat default — a hands-free surface that can card is a turn nobody can
// answer. The mode now rides the request beside the other two.
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

describe("useVoiceSession — the overlay's turn request", () => {
  it("sends the voice tier: model, effort, hands-free mode, voice:true", async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      SilentRecognizer;
    // The spoken ack fetches the daemon TTS proxy — answer it here so the test
    // never opens a socket (its failure path is already covered elsewhere).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const POST = vi.fn(async () => ({
      data: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      response: { ok: true, status: 200 },
    }));

    let session!: ReturnType<typeof useVoiceSession>;
    const Harness = defineComponent({
      setup() {
        session = useVoiceSession({ onEnded: () => {} });
        return () => null;
      },
    });
    const wrapper = mount(Harness, {
      global: { provide: { [vynelClientKey as symbol]: { POST } as unknown as VynelClient } },
    });

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
    wrapper.unmount();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    vi.unstubAllGlobals();
  });
});
