import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import type { SpokenAudioPlayer } from "./spoken-audio-player.js";
import { useSpokenReply, type SpokenReply } from "./use-spoken-reply.js";

// The typed voice turn's voice: sentences queue as the text grows (not at the
// end), only an ARMED turn speaks, and a source switch mid-turn (own stream →
// shared watch, same text) never repeats or skips a sentence.

function mountSpokenReply() {
  const played: string[] = [];
  let cancels = 0;
  const player: SpokenAudioPlayer = {
    play: async (text) => {
      played.push(text);
    },
    cancel: () => {
      cancels += 1;
    },
  };
  let reply!: SpokenReply;
  const wrapper = mount(
    defineComponent({
      setup() {
        reply = useSpokenReply(player);
        return () => null;
      },
    }),
  );
  return { reply, played, cancels: () => cancels, wrapper };
}

describe("useSpokenReply", () => {
  it("speaks each sentence as soon as it closes, then the tail on settle", () => {
    const { reply, played } = mountSpokenReply();
    reply.arm();
    reply.feed("It's 26 degrees ");
    expect(played).toEqual([]);
    reply.feed("It's 26 degrees and clear. Get some ");
    expect(played).toEqual(["It's 26 degrees and clear."]);
    reply.feed("It's 26 degrees and clear. Get some rest");
    reply.settle();
    expect(played).toEqual(["It's 26 degrees and clear.", "Get some rest"]);
  });

  it("stays silent for a turn it was not armed for (a wake-word turn streaming into the panel)", () => {
    const { reply, played } = mountSpokenReply();
    reply.feed("The daemon is already saying this. ");
    reply.settle();
    expect(played).toEqual([]);
  });

  it("survives the source switch: a shorter (lagging) text is ignored, growth beyond what was spoken continues", () => {
    const { reply, played } = mountSpokenReply();
    reply.arm();
    reply.feed("First sentence. Second sen");
    reply.feed("First sent"); // the shared fold, still catching up
    reply.feed("First sentence. Second sentence. Third");
    expect(played).toEqual(["First sentence.", "Second sentence."]);
  });

  it("strips markdown before speaking and skips an empty line", () => {
    const { reply, played } = mountSpokenReply();
    reply.arm();
    reply.feed("**Done.** \n");
    expect(played).toEqual(["Done."]);
  });

  it("cancel stops the player, drops the pending tail, and disarms", () => {
    const { reply, played, cancels } = mountSpokenReply();
    reply.arm();
    reply.feed("One. Two and a half");
    reply.cancel();
    reply.settle();
    expect(played).toEqual(["One."]);
    expect(cancels()).toBe(1);
  });

  it("cancels on unmount so a navigated-away panel never keeps talking", () => {
    const { wrapper, cancels } = mountSpokenReply();
    wrapper.unmount();
    expect(cancels()).toBe(1);
  });
});
