import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { DisplaySessionPhase } from "@vynel/contracts/voice/daemon-events";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { useVynel } from "../use-vynel.js";

// The room telling the user's OTHER windows what conversation it is holding —
// the mirror half of `use-display-toggle`'s `display-active`, and the reason
// the display dock can show a session that lives in the app window.
//
// It is a mirror and never a handover: a Web Speech session belongs to the
// window that opened it and cannot migrate across windows, so the dock draws
// the phase and the caption while the microphone stays here.
//
// ONE home for the announcement, so the room's view and the dock's row can
// never disagree about what is being said.

export interface DisplaySessionAnnouncement {
  /** The room has a voice session — talking, thinking, or muted mid-conversation. */
  readonly live: boolean;
  readonly phase: DisplaySessionPhase;
  readonly caption: string;
}

/** Nothing to mirror: the shape sent when the conversation ends or the room
 *  goes away. */
const ENDED: DisplaySessionAnnouncement = { live: false, phase: "idle", caption: "" };

/** A speaking caption grows a sentence at a time, several times a second — far
 *  faster than a corner row can be read. Liveness and phase never wait: those
 *  are what decide whether the dock is on screen at all. */
const CAPTION_THROTTLE_MS = 250;

export function useDisplaySessionAnnounce(
  session: MaybeRefOrGetter<DisplaySessionAnnouncement>,
): void {
  const vynel = useVynel();
  const live = useLiveChannelStore();

  let sent: DisplaySessionAnnouncement | null = null;
  let sentAtMs = 0;
  let pending: DisplaySessionAnnouncement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    sent = pending;
    pending = null;
    sentAtMs = Date.now();
    // Presence, not state: a lost call costs the dock one stale line until the
    // next change, never the room. (The web app has no logger seam and the
    // house rule bans console output — `notifySessionEnd` is the precedent.)
    void vynel.voice.setDisplaySession(sent).catch(() => {});
  }

  function announce(next: DisplaySessionAnnouncement): void {
    // A snapshot: the caller may hand back a reactive object, and comparing the
    // next value against one that mutates underneath us would skip changes.
    pending = { live: next.live, phase: next.phase, caption: next.caption };
    const changesTheShape =
      sent === null || next.live !== sent.live || next.phase !== sent.phase;
    const waitMs = changesTheShape
      ? 0
      : Math.max(0, CAPTION_THROTTLE_MS - (Date.now() - sentAtMs));
    if (waitMs === 0) {
      flush();
      return;
    }
    // The trailing edge is kept deliberately: the last caption of a reply must
    // land, or the dock keeps a sentence the room has already moved past.
    timer ??= setTimeout(flush, waitMs);
  }

  watch(() => toValue(session), announce, { immediate: true });

  // An engine restart empties the hub's memo of this, and nothing about the
  // conversation changed to announce it again — so a reconnect says it over.
  // The same fix `use-display-toggle` carries, for the same reason.
  watch(
    () => live.status,
    (status) => {
      if (status === "open") announce(toValue(session));
    },
  );

  onScopeDispose(() => {
    // A caption queued a moment ago must never land AFTER this: the dock would
    // mirror a conversation whose room is gone.
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = ENDED;
    flush();
  });
}
