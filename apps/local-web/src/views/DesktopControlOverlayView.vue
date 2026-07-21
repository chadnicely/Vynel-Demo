<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ApprovalCard, ClaudeMark, PresenceDot, describeDesktopStep } from "@vynel/ui";
import { useVynel } from "../composables/use-vynel.js";
import { useSessionActivityFeed } from "../composables/activity/use-session-activity-feed.js";
import { useDesktopActivityStore } from "../stores/desktop-activity-store.js";
import { isDesktopOverlayVisible } from "../stores/desktop-activity-fold.js";
import { usePendingApprovals } from "../composables/approvals/use-pending-approvals.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import { createOverlayWindowControls } from "../composables/voice/tauri-overlay-window.js";

// The desktop-control attention overlay — a bare always-on-top window that
// narrates, step by step, what Claude is doing to the user's desktop while a
// turn drives the mcp__desktop__* tools: current step, recent steps, the
// approval card for a mutating action, and a Stop lever. Burst-based: appears
// on the first desktop step, lingers ~8s after the last, hides. Bare routes
// bypass AppShell, so this view mounts its OWN /activity/stream subscription
// (the feed folds into the desktop-activity store this view reads).

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

const isVisible = computed(() =>
  isDesktopOverlayVisible(desktopActivity.state, nowMs.value),
);

const runningStep = computed(() =>
  [...desktopActivity.state.steps].reverse().find((step) => step.status === "running"),
);
const settledSteps = computed(() =>
  desktopActivity.state.steps.filter((step) => step.status !== "running").slice(-3),
);

function stepLabel(toolName: string, toolInput: unknown): string {
  return describeDesktopStep(toolName, toolInput) ?? toolName;
}

// Only DESKTOP approvals belong on this window — everything else stays with
// the main window's ApprovalNotifier.
const desktopApprovals = computed(() =>
  (pendingQuery.data.value ?? []).filter((approval) =>
    approval.toolName.startsWith("mcp__desktop__"),
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
async function stopTurn() {
  // Desktop tools ride the global root — its server-side interrupt is the lever.
  isStopping.value = true;
  try {
    await vynel.root.interruptTurn();
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
      <header class="overlay-header" data-tauri-drag-region>
        <ClaudeMark :size="18" />
        <span class="overlay-title">Claude is using your desktop</span>
        <PresenceDot :state="desktopApprovals.length > 0 ? 'attention' : 'live'" />
      </header>

      <div class="current-step" v-if="runningStep">
        <span class="step-spinner" aria-hidden="true" />
        <span class="step-label">{{ stepLabel(runningStep.toolName, runningStep.toolInput) }}</span>
      </div>
      <div class="current-step is-idle" v-else>
        <span class="step-label">{{
          desktopApprovals.length > 0 ? "Waiting for your approval" : "Finishing up…"
        }}</span>
      </div>

      <ul class="settled-steps" v-if="settledSteps.length > 0">
        <li v-for="step in settledSteps" :key="step.toolUseId" class="settled-step">
          <span class="step-status" :class="`is-${step.status}`" aria-hidden="true">{{
            step.status === "completed" ? "✓" : "✕"
          }}</span>
          <span class="step-label">{{ stepLabel(step.toolName, step.toolInput) }}</span>
        </li>
      </ul>

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

      <footer class="overlay-footer">
        <button class="stop-button" :disabled="isStopping" @click="stopTurn">
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
  display: grid;
  gap: 10px;
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
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
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
