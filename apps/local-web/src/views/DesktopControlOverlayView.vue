<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ApprovalCard,
  ClaudeMark,
  PresenceDot,
  describeDesktopStep,
  DESKTOP_TOOL_PREFIX,
} from "@vynel/ui";
import { useVynel } from "../composables/use-vynel.js";
import { useSessionActivityFeed } from "../composables/activity/use-session-activity-feed.js";
import { useDesktopActivityStore } from "../stores/desktop-activity-store.js";
import {
  isControllingDesktop,
  isDesktopOverlayVisible,
} from "../stores/desktop-activity-fold.js";
import { usePendingApprovals } from "../composables/approvals/use-pending-approvals.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import { createOverlayWindowControls } from "../composables/voice/tauri-overlay-window.js";

// The desktop-control attention overlay — a bare always-on-top window that
// narrates, step by step, what Claude is doing to the user's desktop while a
// turn drives the mcp__desktop__* tools: the approval card, what was approved,
// the current step, the settled log, and a Stop lever. It appears on the first
// desktop step in EVERY permission mode (ask only adds the card) and stays up
// continuously until the turn ends or IDLE_HIDE_MS passes with no desktop
// activity. Bare routes bypass AppShell, so this view mounts its OWN
// activity subscription — its own live socket (the feed folds into the desktop-activity
// store this view reads).
//
// LOOKING vs CONTROLLING is the distinction the header makes: reading the
// screen and driving it are very different things to have happening behind
// your back, so the banner changes the moment a plan is armed.

const WINDOW_TITLE = "Claude on your desktop";
// Mirrors the desktop-overlay window's inner_size (src-tauri/windows.rs).
const overlayWindow = createOverlayWindowControls({
  width: 380,
  height: 360,
  park: "bottom-right",
  // Never steal keyboard focus — the user may be typing in the app Claude is
  // reading; the approval buttons still work on click.
  focusOnReveal: false,
});

useSessionActivityFeed();
const vynel = useVynel();
const desktopActivity = useDesktopActivityStore();
const pendingQuery = usePendingApprovals();
const decideApproval = useDecideApproval();

// The linger rule depends on wall time — tick so the hide fires on schedule.
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;

// The fold's rule OR "a desktop card is waiting". Belt-and-braces on purpose:
// the main window HIDES desktop cards while this shell is running, so if the
// fold ever missed the bell (a feed reconnect replays only the turn's last
// step) the card would exist with nowhere to decide it. A ghost panel is a far
// smaller failure than an approval the user cannot answer.
const isVisible = computed(
  () =>
    isDesktopOverlayVisible(desktopActivity.state, nowMs.value) ||
    desktopApprovals.value.length > 0,
);

const isControlling = computed(() => isControllingDesktop(desktopActivity.state));
const activePlan = computed(() => desktopActivity.state.activePlan);

const runningStep = computed(() =>
  [...desktopActivity.state.steps].reverse().find((step) => step.status === "running"),
);
// The full settled log (newest last) — rendered in a scrollable box so it never
// pushes the pinned approval card or the current step off the window.
const settledSteps = computed(() =>
  desktopActivity.state.steps.filter((step) => step.status !== "running"),
);

function stepLabel(toolName: string, toolInput: unknown): string {
  return describeDesktopStep(toolName, toolInput) ?? toolName;
}

// Only DESKTOP approvals belong on this window — everything else stays with
// the main window's ApprovalNotifier. This predicate must stay the EXACT
// complement of that notifier's filter, or a card lands in neither place.
const desktopApprovals = computed(() =>
  (pendingQuery.data.value ?? []).filter((approval) =>
    approval.toolName.startsWith(DESKTOP_TOOL_PREFIX),
  ),
);

function decide(providerApprovalId: string, kind: "approved" | "denied") {
  decideApproval.mutate(
    kind === "approved"
      ? { providerApprovalId, kind }
      : { providerApprovalId, kind, reason: "Denied from the desktop overlay" },
  );
}

const isStopping = ref(false);

// Desktop work no longer rides only the global root: a spawned session drives it
// in the background (desktop-autopilot), and THAT turn is stopped through a
// different route. Firing the root interrupt at a delegated turn would leave the
// mouse moving while killing an unrelated root turn — and the route returns
// `{ interrupted: true }` either way, so it would read as success.
const trackedTurn = computed(() => desktopActivity.state.trackedTurn);
// Stop is offered ONLY when the turn maps to a route that actually stops IT.
// There are two, and everything else must refuse rather than fire the nearest
// one and report success:
//   • a delegated turn  -> root.stopDelegation(partialSessionId)
//   • the global root   -> root.interruptTurn()
// A turn running on its own continuing session (the UI's spawned-session
// surface) announces `origin: 'web'` exactly like a root turn, so origin alone
// cannot tell them apart — but it carries a primarySessionId, and the root
// interrupt would resolve the GLOBAL primary and stop a different session
// entirely while the mouse kept moving. That surface has no server-side
// interrupt yet, so the honest answer there is a disabled button.
const canStop = computed(() => {
  const turn = trackedTurn.value;
  // origin null = we attached mid-turn and never saw turn-started, so we do not
  // know who is driving. Refusing beats stopping the wrong turn.
  if (turn === null || turn.origin === null) return false;
  if (turn.origin === "delegation") return turn.partialSessionId !== null;
  return turn.primarySessionId === null;
});

async function stopTurn() {
  const turn = trackedTurn.value;
  if (turn === null || !canStop.value) return;
  isStopping.value = true;
  try {
    if (turn.origin === "delegation" && turn.partialSessionId !== null) {
      await vynel.root.stopDelegation(turn.partialSessionId);
    } else {
      await vynel.root.interruptTurn();
    }
  } catch {
    // Best-effort: the turn may have just ended; the feed's turn-ended hides us.
  } finally {
    isStopping.value = false;
  }
}

watch(isVisible, (visible) => {
  if (visible) {
    overlayWindow.park();
    overlayWindow.reveal();
  } else {
    overlayWindow.dismiss();
  }
});

onMounted(() => {
  document.title = WINDOW_TITLE;
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1_000);
  if (overlayWindow.isTauri) {
    // The Tauri window is transparent — the page background must be too, so
    // only the rounded card reads as the overlay.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }
});

onUnmounted(() => {
  if (tickTimer !== undefined) clearInterval(tickTimer);
});
</script>

<template>
  <div class="overlay-window" :class="{ 'is-tauri': overlayWindow.isTauri }">
    <div class="overlay-card">
      <header
        class="overlay-header"
        :class="{ 'is-controlling': isControlling }"
        data-tauri-drag-region
      >
        <ClaudeMark :size="18" />
        <span class="overlay-title">{{
          isControlling
            ? "Claude is controlling your desktop"
            : "Claude is looking at your desktop"
        }}</span>
        <PresenceDot :state="desktopApprovals.length > 0 ? 'attention' : 'live'" />
      </header>

      <!-- What the user approved — the running steps below are Claude working
           through THIS. Shown verbatim; the overlay never claims which step is
           current, because nothing reports that. -->
      <div v-if="activePlan" class="plan-panel">
        <p class="plan-goal">{{ activePlan.goal }}</p>
        <ol class="plan-steps">
          <li v-for="(step, index) in activePlan.steps" :key="index">{{ step }}</li>
        </ol>
      </div>

      <!-- PINNED: an approval must never scroll away under the step log. It sits
           right below the header, above the current step + the log. -->
      <div v-if="desktopApprovals.length > 0" class="approval-zone">
        <p class="approval-heading">Approve to continue</p>
        <ApprovalCard
          v-for="approval in desktopApprovals"
          :key="approval.id"
          compact
          :tool-name="approval.toolName"
          :tool-input="approval.toolInput"
          :action-kind="approval.actionKind"
          context-label="your desktop"
          :busy="decideApproval.isPending.value"
          class="overlay-approval"
          @approve="decide(approval.providerApprovalId, 'approved')"
          @deny="decide(approval.providerApprovalId, 'denied')"
        />
      </div>

      <div class="current-step" v-if="runningStep">
        <span class="step-spinner" aria-hidden="true" />
        <span class="step-label">{{ stepLabel(runningStep.toolName, runningStep.toolInput) }}</span>
      </div>
      <div class="current-step is-idle" v-else>
        <span class="step-label">{{
          desktopApprovals.length > 0 ? "Waiting for your approval" : "Finishing up…"
        }}</span>
      </div>

      <!-- The full progress log — scrolls in its own box so it can't push the
           approval or the current step off the window. -->
      <ul class="settled-steps" v-if="settledSteps.length > 0">
        <li v-for="step in settledSteps" :key="step.toolUseId" class="settled-step">
          <span class="step-status" :class="`is-${step.status}`" aria-hidden="true">{{
            step.status === "completed" ? "✓" : "✕"
          }}</span>
          <span class="step-label">{{ stepLabel(step.toolName, step.toolInput) }}</span>
        </li>
      </ul>

      <footer class="overlay-footer">
        <button
          class="stop-button"
          :disabled="isStopping || !canStop"
          :title="
            canStop
              ? 'Stop what Claude is doing'
              : 'Can\'t stop this from here — stop it from the conversation it\'s running in'
          "
          @click="stopTurn"
        >
          {{ isStopping ? "Stopping…" : "Stop" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay-window {
  height: 100vh;
  display: grid;
  align-items: end;
  background: var(--bg-shell);
}

.overlay-window.is-tauri {
  background: transparent;
}

.overlay-card {
  margin: 10px;
  /* Flex column with a bounded height so the settled-step log (below) scrolls
     inside the card instead of pushing the pinned approval / current step out
     of the window. */
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 20px);
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--edge-2, rgb(255 255 255 / 0.12));
  background: var(--bg-panel);
  box-shadow: 0 8px 32px rgb(0 0 0 / 0.45);
}

.overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
  flex: none;
}

/* Controlling the machine is a different state from reading it — the header
   carries that weight so it registers peripherally, without a second banner. */
.overlay-header.is-controlling .overlay-title {
  color: var(--gold, #d4a24e);
}

/* The approved plan — scrolls with the log rather than pinning, so a long plan
   can never push the current step or the Stop button off the window. */
.plan-panel {
  flex: none;
  max-height: 96px;
  overflow-y: auto;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--edge-2, rgb(255 255 255 / 0.1));
}

.plan-goal {
  margin: 0 0 4px;
  color: var(--ink-2);
  font: 600 11.5px/1.4 var(--font-ui);
}

.plan-steps {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 2px;
  color: var(--ink-3);
  font: 400 11px/1.45 var(--font-ui);
}

/* The pinned approval zone — never scrolls, accented so it's unmissable. */
.approval-zone {
  flex: none;
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--gold, #d4a24e);
  background: var(--gold-soft, rgb(212 162 78 / 0.12));
}

.approval-heading {
  margin: 0;
  color: var(--gold, #d4a24e);
  font: 600 11px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.current-step {
  flex: none;
}

.overlay-title {
  flex: 1;
  color: var(--ink-1);
  font: 600 12px/1.4 var(--font-ui);
}

.current-step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.current-step .step-label {
  color: var(--ink-1);
  font: 500 13px/1.4 var(--font-ui);
}

.current-step.is-idle .step-label {
  color: var(--ink-3);
}

.step-spinner {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
  border: 2px solid var(--gold);
  border-top-color: transparent;
  animation: step-spin 0.9s linear infinite;
}

@keyframes step-spin {
  to {
    transform: rotate(360deg);
  }
}

.settled-steps {
  margin: 0;
  padding: 0 2px 0 0;
  list-style: none;
  display: grid;
  gap: 4px;
  /* The one growing/scrolling region — takes remaining height, scrolls its own
     overflow so the log never buries the pinned approval or the Stop button. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.settled-step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settled-step .step-label {
  color: var(--ink-3);
  font: 400 12px/1.4 var(--font-ui);
}

.step-status {
  flex: none;
  font: 600 11px/1 var(--font-ui);
  color: var(--ink-3);
}

.step-status.is-completed {
  color: var(--gold);
}

.step-status.is-failed,
.step-status.is-denied,
.step-status.is-cancelled {
  color: var(--danger, #e5484d);
}

.overlay-footer {
  display: flex;
  justify-content: flex-end;
  flex: none;
}

.stop-button {
  padding: 5px 14px;
  border-radius: 8px;
  border: 1px solid var(--edge-2, rgb(255 255 255 / 0.16));
  background: transparent;
  color: var(--ink-2);
  font: 600 12px/1.4 var(--font-ui);
  cursor: pointer;
}

.stop-button:hover:not(:disabled) {
  border-color: var(--danger, #e5484d);
  color: var(--danger, #e5484d);
}

.stop-button:disabled {
  opacity: 0.6;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .step-spinner {
    animation: none;
  }
}
</style>
