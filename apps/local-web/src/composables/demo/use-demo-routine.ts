import { watch } from "vue";
import { useRouter } from "vue-router";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import { useDemoStore, DEMO_LINE_GAP_SECONDS } from "../../stores/demo-store.js";
import { pickDemoGreeting } from "../../demo/demo-script-writer.js";

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
/** The beat on a cut between the orb and the node screen. */
const CUT_BEAT_MS = 180;
/** The constellation mounts and lays out before the first product speaks. */
const SCENE_SETTLE_MS = 420;

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
    demo.isRoutineRunning = true;
    try {
      // NEVER WAIT ON THE WHOLE BANK. Recording is one shared queue, so a take
      // fired moments after Approve all used to sit silent behind a hundred
      // other lines (Chad, 2026-08-28, filming). The take starts NOW: any line
      // of its own that is not recorded yet is synthesized on demand as it is
      // reached, and the rest of the bank keeps recording behind the film.
      void demo.prepareAudio();
      // The daemon now believes a web recognizer owns the room: its native
      // STT stays off the microphone and nothing talks over the take.
      void fetch("/voice/session/start", { method: "POST" }).catch(() => {});
      // The room is dressed and greeted only when a take STARTS. The software
      // half continues a video already running: re-rolling the look or saying
      // hello again mid-film would break it in two.
      const opensTheVideo = demo.requestedPart !== "software";
      if (opensTheVideo) {
        demo.randomizeLook();
        if (!ui.nodesThemed) ui.toggleNodesThemed();
        ui.nodesMode = "nodes";
        demo.resetRoutineScene();
        ui.activateTab(GLOBAL_TAB_ID);
        options.showDisplay();
        await beat(ROOM_SETTLE_MS);
        await demo.playRecordedLine(pickDemoGreeting(Math.random));
        if (!demo.isRoutineRunning) return;
        await beat(CUT_BEAT_MS);
      }

      // The take asked for by name (a card's Demo button), else the queue's
      // turn — which is what a spoken trigger films. A trigger plays HALF a
      // take: the wake phrase the evening update, the follow-up question the
      // products (Chad, 2026-08-28).
      const take = demo.takeToFilm;
      const part = demo.requestedPart;
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
            // THE HANDOFF (Chad, 2026-08-28): the orb announces the dev
            // updates, THEN the film cuts. Spoken here rather than written
            // into the script, so the card shows only the content he reads.
            const intro = demo.pickIntroLine();
            if (intro !== null) await demo.playRecordedLine(intro);
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
        await demo.playRecordedLine(line.text);
        if (line.projectId !== null) demo.settleProject(line.projectId, index);
        await beat(DEMO_LINE_GAP_SECONDS * 1000);
      }

      // THE CLOSE — the last thing said, over the fully lit board. It belongs
      // to the END of a take: an opening half stops on the orb and WAITS for
      // the follow-up question, so signing off there would end the video
      // before the products were ever shown.
      if (demo.isRoutineRunning && part !== "opening") {
        const conclusion = demo.pickConclusionLine();
        if (conclusion !== null) await demo.playRecordedLine(conclusion);
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
      demo.requestedScriptId = null;
      // An UNARMED rehearsal has no disarm coming to clean up after it — the
      // scripted fleet must not stay parked over the real one.
      if (!demo.isArmed) demo.clearRoutineScene();
      void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
    }
  }

  watch(
    () => demo.routineRequestCount,
    () => void run(),
  );

  return { runRoutine: run };
}
