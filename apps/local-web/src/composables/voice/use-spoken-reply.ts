import { onScopeDispose } from "vue";
import { SpokenSentenceBuffer, stripSpokenMarkup } from "@vynel/voice";
import { createSpokenAudioPlayer, type SpokenAudioPlayer } from "./spoken-audio-player.js";

// Speak a typed voice turn's streamed reply in the browser (voice-realtime
// VR1, the Voice chat panel): the thread's text IS its voice, so the panel
// feeds the turn's assistant text as it grows and every sentence that closes
// is queued on the browser player — pipelined, the first one sounds before
// the reply is done. ARMED per send: only the turn THIS window typed speaks;
// a wake-word turn streaming into the same panel is the overlay's (or the
// daemon's) to voice, never ours — double speech is the failure this guards.
//
// Fed with the WHOLE text so far, not deltas, because the panel's view of a
// turn switches source mid-way (its origin stream detaches to the shared
// watch once that has the turn) — the growth beyond what was already spoken
// is what's new, whichever fold is rendering.

export interface SpokenReply {
  /** The next turn is this window's — speak what it streams. */
  arm(): void;
  /** The turn's assistant text so far; new sentences are queued to play. */
  feed(text: string): void;
  /** The turn settled — speak the tail and disarm. */
  settle(): void;
  /** Stop speaking (Stop, unmount) and disarm. */
  cancel(): void;
}

export function useSpokenReply(
  player: SpokenAudioPlayer = createSpokenAudioPlayer(),
): SpokenReply {
  let isArmed = false;
  let sentences = new SpokenSentenceBuffer();
  let spokenLength = 0;

  function speak(sentence: string): void {
    const line = stripSpokenMarkup(sentence);
    if (line !== "") void player.play(line);
  }

  function arm(): void {
    isArmed = true;
    sentences = new SpokenSentenceBuffer();
    spokenLength = 0;
  }

  function feed(text: string): void {
    if (!isArmed || text.length <= spokenLength) return;
    const delta = text.slice(spokenLength);
    spokenLength = text.length;
    for (const sentence of sentences.push(delta)) speak(sentence);
  }

  function settle(): void {
    if (!isArmed) return;
    for (const sentence of sentences.flush()) speak(sentence);
    isArmed = false;
  }

  function cancel(): void {
    isArmed = false;
    sentences = new SpokenSentenceBuffer();
    spokenLength = 0;
    player.cancel();
  }

  onScopeDispose(cancel);

  return { arm, feed, settle, cancel };
}
