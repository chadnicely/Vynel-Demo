import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import type { VynelClient } from "@vynel/sdk";
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
