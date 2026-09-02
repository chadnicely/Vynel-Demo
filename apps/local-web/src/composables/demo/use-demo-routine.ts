import { nextTick, watch } from "vue";
import { useRouter } from "vue-router";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import { useDemoStore, DEMO_LINE_GAP_SECONDS } from "../../stores/demo-store.js";
import { FALLBACK_CONVERSATION } from "../../demo/demo-conversation.js";
import { REVEAL_MS } from "../../demo/demo-reveal-chime.js";

// The filmed routine, beat by beat (Chad, 2026-08-28): wake → the Display
// wakes in a re-rolled look and speaks one greeting → the node screen, in the
// same palette, with each scripted project lighting up AS its bullet plays.
// Every spoken line is pre-recorded (demo-audio), so no beat ever waits on a
// model — the whole point of the routine is a take with zero latency in it.
//
// Lives in the shell (one per window), triggered by the store's ring-the-bell
// counter: the wake lands in whichever component holds the daemon link, but
// only the shell has the router and the Display switch.

// The pauses, all trimmed for camera (Chad, 2026-08-28) — long enough that a
// cut never lands mid-word, short enough that the take never feels like it is
// waiting for something.

/** The room fades in before it speaks — a voice from a black screen reads as
 *  a glitch on camera. */
const ROOM_SETTLE_MS = 600;
/** The black may not lift until the room is genuinely on screen. A fixed
 *  320ms was a guess about how long mounting takes, and on a cold tab the
 *  guess lost: the bloom opened onto the dashboard, again (Chad,
 *  2026-09-01: “I still see that dashboard screen before the AI comes on”).
 *  So the routine WATCHES for the stage instead — the element in the DOM,
 *  then two painted frames so the canvas is real — with a cap so a broken
 *  room cannot hold the film black forever. */
const ROOM_PAINT_CAP_MS = 5000;

async function waitForRoomPainted(): Promise<void> {
  if (typeof document === "undefined") return;
  const frame = (): Promise<void> =>
    new Promise((resolve) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => resolve())
        : setTimeout(resolve, 16),
    );
  const deadline = Date.now() + ROOM_PAINT_CAP_MS;
  while (Date.now() < deadline) {
    if (document.querySelector('[data-testid="display-stage"]') !== null) break;
    await frame();
  }
  // Two more frames: mounted is not painted.
  await frame();
  await frame();
}
/** The beat on a cut between the orb and the node screen. */
const CUT_BEAT_MS = 180;
/** The constellation mounts and lays out before the first product speaks. */
const SCENE_SETTLE_MS = 420;
/** How long it appears to be looking something up. Long enough to read as
 *  work, short enough that nobody reaches for the remote. */
const THINKING_MS = 1250;
/** The shorter beat after he says yes — it is fetching, not researching. */
const GATHERING_MS = 700;

export function useDemoRoutine(options: {
  /** The shell's OWN display toggle — a second `useDisplayToggle()` here
   *  would double every display-active announcement to the dock. */
  showDisplay: () => void;
  leaveDisplay: () => void;
}) {
  const ui = useUiStore();
  const demo = useDemoStore();
  const router = useRouter();

  const beat = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function run(): Promise<void> {
    if (demo.isRoutineRunning) return;
    // BLACK BEFORE THE SLATE GOES (Chad, 2026-08-30: “it flashed back to the
    // admin screen”). The slate is dismissed the moment a take starts running,
    // and the show's own black only went up several statements later — for
    // those frames the app underneath was on camera. Raising it first means
    // one black hands straight over to the other.
    // A WHOLE take opens a video too. Only the halves that CONTINUE one — the
    // numbers, the products — join a room that is already lit.
    //
    // Missing “whole” here is why the Demo button flashed the dashboard: the
    // slate is dismissed the instant a take runs, and with no black raised
    // for this path there was nothing between the countdown and the room
    // (Chad, 2026-08-31: “right after 3, 2, 1 it went to the Good morning
    // screen”).
    const opensTheVideo =
      demo.requestedPart === "opening" || demo.requestedPart === "whole";
    if (opensTheVideo) demo.isBlackout = true;
    demo.isRoutineRunning = true;
    try {
      // NEVER WAIT ON THE WHOLE BANK. Recording is one shared queue, so a take
      // fired moments after Approve all used to sit silent behind a hundred
      // other lines (Chad, 2026-08-28, filming). The take starts NOW: any line
      // of its own that is not recorded yet is synthesized on demand as it is
      // reached, and the rest of the bank keeps recording behind the film.
      void demo.prepareAudio();
      // THE DAEMON KEEPS THE ROOM (Chad, 2026-08-30: “it's not hearing me”).
      //
      // This used to hand the microphone off to a web recognizer for the
      // duration of the take. Nothing ever took it: the film has no recognizer
      // of its own, so after the first half the daemon had stopped listening
      // and NOTHING was — the second and third exchanges could not be spoken
      // at all, and the screen sat black. The daemon holds its microphone open
      // by design and will not release it, so a second recognizer only ever
      // collided with it (“microphone in use”).
      //
      // Armed, it stays awake for the whole shoot and every exchange is spoken
      // to the same ears. A wake landing while a take is already running is
      // harmless — `run()` returns early — so the assistant's own voice coming
      // back off the speakers cannot skip him ahead.
      if (demo.isArmed) {
        // GIVE THE ROOM BACK (Chad, 2026-08-30). Delivering a wake to a
        // wake-capable window hands the daemon's microphone to that window
        // and stops it transcribing — it expects a browser recognizer to take
        // over the conversation. The film has none: it answers from recorded
        // audio. So the handoff left NOBODY listening, and the second and
        // third exchanges could not be spoken at all. Measured on his machine:
        // the microphone still captured his voice (rms 0.08, plainly speech)
        // and not one segment was cut from it.
        //
        // Ending the handoff immediately puts the daemon back to wake-
        // listening for the rest of the shoot. A wake landing mid-take is
        // harmless — `run()` returns early — so the assistant's own voice off
        // the speakers cannot skip an exchange.
        void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
      } else {
        void fetch("/voice/session/start", { method: "POST" }).catch(() => {});
      }
      // The room is dressed and greeted only when a take STARTS. The software
      // half continues a video already running: re-rolling the look or saying
      // hello again mid-film would break it in two.
      if (opensTheVideo) {
        // EXCHANGE ONE: he speaks, the room OPENS, and then it answers.
        //
        // The reply used to play first, over the black, with the reveal after
        // it — so the transition arrived while the assistant was already
        // talking and read as a late arrival rather than an entrance (Chad,
        // 2026-08-30). The room now wakes on the hit and speaks from a lit
        // screen, which is the order a film would cut it in.
        demo.randomizeLook();
        if (!ui.nodesThemed) ui.toggleNodesThemed();
        ui.nodesMode = "nodes";
        demo.resetRoutineScene();
        ui.activateTab(GLOBAL_TAB_ID);
        options.showDisplay();
        // PAINTED, not merely requested — and watched, not guessed at.
        await nextTick();
        await waitForRoomPainted();
        if (!demo.isRoutineRunning) return;
        // Dressed behind the black — the reveal shows a finished room.
        demo.isBlackout = false;
        // Let the hit land and the light finish arriving before it speaks.
        await beat(REVEAL_MS);
        if (!demo.isRoutineRunning) return;
        // IT OFFERS, IT DOES NOT LAUNCH IN (Chad, 2026-08-30). The take used
        // to answer and run straight into the report. Now it says how things
        // are and ASKS — and the film STOPS there, because the answer is his
        // to give. “Yeah, go on” is a whole exchange of its own.
        await demo.playRecordedLine(
          (demo.takeToFilm?.conversation ?? FALLBACK_CONVERSATION).opening,
        );
        if (!demo.isRoutineRunning) return;
        await beat(CUT_BEAT_MS);
        // Spoken, the film stops here and waits for his “yes”. Played from
        // the Demo button it is a rehearsal of the whole thing, so it carries
        // on into the numbers by itself.
        if (demo.requestedPart === "opening") {
          demo.finishedPart("opening");
          return;
        }
        await demo.playRecordedLine(
          (demo.takeToFilm?.conversation ?? FALLBACK_CONVERSATION).handover,
        );
        if (!demo.isRoutineRunning) return;
        demo.isThinking = true;
        await beat(GATHERING_MS);
        demo.isThinking = false;
        if (!demo.isRoutineRunning) return;
      }

      // The take asked for by name (a card's Demo button), else the queue's
      // turn — which is what a spoken trigger films. A trigger plays HALF a
      // take: the wake phrase the evening update, the follow-up question the
      // products (Chad, 2026-08-28).
      const take = demo.takeToFilm;
      const talk = take?.conversation ?? FALLBACK_CONVERSATION;
      const part = demo.requestedPart;
      // He said yes — hand in before the first figure lands.
      if (part === "numbers") {
        await demo.playRecordedLine(talk.handover);
        if (!demo.isRoutineRunning) return;
        demo.isThinking = true;
        await beat(GATHERING_MS);
        demo.isThinking = false;
        if (!demo.isRoutineRunning) return;
      }
      const lines =
        part === "whole" ? (take?.lines ?? []) : demo.takeLines(take, part);
      // THE CAMERA FOLLOWS THE WORDS (Chad, 2026-08-28): the assistant's own
      // lines play on the orb, and a software update cuts to the node screen
      // with that product lit. The cut happens only when the surface actually
      // changes — re-navigating between two node lines would remount the
      // constellation and throw away the dots already lit.
      let onNodes = false;
      for (const [index, line] of lines.entries()) {
        if (!demo.isRoutineRunning) return; // disarmed mid-take
        const wantsNodes = line.surface === "nodes";
        if (wantsNodes !== onNodes) {
          if (wantsNodes) {
            // EXCHANGE TWO (Chad, 2026-08-29): "How we looking on software?"
            // — the reply on the orb, THEN the film cuts to the products.
            await demo.playRecordedLine(talk.software);
            if (!demo.isRoutineRunning) return;
            // It said it would check. So it checks.
            demo.isThinking = true;
            await beat(THINKING_MS);
            demo.isThinking = false;
            if (!demo.isRoutineRunning) return;
            if (!demo.isRoutineRunning) return;
            await router.push({ name: "nodes" });
            // The tab must not restore INTO the Display afterwards.
            options.leaveDisplay();
            await beat(SCENE_SETTLE_MS);
          } else {
            options.showDisplay();
            await beat(CUT_BEAT_MS);
          }
          onNodes = wantsNodes;
          if (!demo.isRoutineRunning) return;
        }
        if (line.projectId !== null) demo.lightProject(line.projectId, index);
        await demo.playRecordedLine(line.text, line.surface);
        if (line.projectId !== null) demo.settleProject(line.projectId, index);
        await beat(DEMO_LINE_GAP_SECONDS * 1000);
      }

      // THE CLOSE — the last thing said, over the fully lit board. It belongs
      // to the END of a take: an opening half stops on the orb and WAITS for
      // the follow-up question, so signing off there would end the video
      // before the products were ever shown.
      if (demo.isRoutineRunning && part !== "opening") {
        // THE TAKE'S OWN WRAP. This drew from a small shared pool, so every
        // take in a reel ended on the same sentence however different the
        // rest of it was (Chad, 2026-08-31: “it always says the same end”).
        await demo.playRecordedLine(talk.wrap, onNodes ? "nodes" : "hud");
      }
      // Where the next spoken trigger picks up.
      if (part !== "whole") demo.finishedPart(part);
      // The lit board STAYS on screen for the outro — disarming clears it.
      // A take played from its own Demo button does NOT move the queue on: it
      // was a look at that one, not the next video in the rotation. Nor does
      // an opening half — the take is still mid-film.
      if (demo.requestedScriptId === null && part !== "opening") demo.advanceQueue();
    } finally {
      demo.isRoutineRunning = false;
      demo.isThinking = false;
      // A run that ended mid-exchange-one must not leave the window black —
      // the sign-off's own blackout is raised after this, never during.
      demo.isBlackout = false;
      // THE TAKE SURVIVES THE EXCHANGE. Clearing it here was right when a
      // run WAS the whole film; now a film is four runs, and dropping the
      // staged take after the first one meant exchanges two, three and four
      // filmed whatever the queue's rotation offered instead — a different
      // video, mid-video. It is released when the conversation ends.
      if (demo.nextPart === "opening") demo.requestedScriptId = null;
      // An UNARMED rehearsal has no disarm coming to clean up after it — the
      // scripted fleet must not stay parked over the real one.
      if (!demo.isArmed) demo.clearRoutineScene();
      // Armed, the room is already back with the daemon and must STAY there:
      // the next exchange is spoken to it. Unarmed, this releases the handoff
      // the take took.
      void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
    }
  }

  watch(
    () => demo.routineRequestCount,
    () => void run(),
  );

  return { runRoutine: run };
}
