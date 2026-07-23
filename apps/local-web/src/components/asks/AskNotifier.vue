<script setup lang="ts">
import { computed, ref } from "vue";
import type { AskRequestResponse } from "@vynel/contracts/asks/ask-http";
import { usePendingAsks } from "../../composables/asks/use-pending-asks.js";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useDismissAsk } from "../../composables/asks/use-dismiss-ask.js";
import AskWizardDialog from "./AskWizardDialog.vue";
import { useBrowserStore } from "../../stores/browser-store.js";

// Asks surface like approvals (the notifier precedent): whatever view is
// open, the newest pending ask slides in bottom-right, answerable on the
// spot. One card at a time — v1 keeps concurrent asks as a "+N more" note.
const browser = useBrowserStore();
const pendingQuery = usePendingAsks();
const approvalsQuery = usePendingApprovals();
const dismissAsk = useDismissAsk();

const newest = computed(() => pendingQuery.data.value?.[0] ?? null);
const moreCount = computed(() =>
  Math.max(0, (pendingQuery.data.value?.length ?? 0) - 1),
);
const questionCountLabel = computed(() => {
  const count = newest.value?.questions.length ?? 0;
  return count === 1 ? "1 quick question" : `${count} quick questions`;
});

// The approval stack owns the corner — step aside while any approval is up so
// the two notifiers never cover each other.
const besideApprovals = computed(
  () => (approvalsQuery.data.value?.length ?? 0) > 0,
);

// The wizard holds a snapshot so the card can leave the poll while it's open
// (answering removes the row; the dialog must not vanish mid-typing).
const activeAsk = ref<AskRequestResponse | null>(null);
const isWizardOpen = ref(false);

function openWizard() {
  if (!newest.value) return;
  activeAsk.value = newest.value;
  isWizardOpen.value = true;
}

function dismiss() {
  if (!newest.value) return;
  dismissAsk.mutate(newest.value.id);
}
</script>

<template>
  <div
    class="ask-notifier"
    :class="{
      'beside-approvals': besideApprovals,
      'dock-start': browser.isOpen,
    }"
    aria-live="polite"
  >
    <Transition name="toast">
      <div
        v-if="newest && !isWizardOpen"
        :key="newest.id"
        class="toast rounded-lg border border-hair-strong bg-raised p-3 shadow-overlay"
      >
        <p class="m-0 text-[12.5px] font-semibold text-ink-1">
          Claude needs your input
        </p>
        <p class="m-0 mt-1 text-xs text-ink-2">
          {{ newest.questions[0]?.label }}
        </p>
        <p class="m-0 mt-0.5 text-[11px] text-ink-3">{{ questionCountLabel }}</p>
        <div class="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            class="cursor-default rounded-sm bg-gold px-3.5 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright"
            @click="openWizard"
          >
            Answer
          </button>
          <button
            type="button"
            class="cursor-default rounded-sm px-2 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink-1"
            :disabled="dismissAsk.isPending.value"
            @click="dismiss"
          >
            Dismiss
          </button>
        </div>
        <p class="m-0 mt-1.5 text-[10.5px] text-ink-3">
          Dismiss lets Claude carry on without your answers.
        </p>
        <p v-if="moreCount > 0" class="m-0 mt-1 text-[10.5px] text-ink-3">
          +{{ moreCount }} more waiting
        </p>
      </div>
    </Transition>
    <AskWizardDialog
      v-if="activeAsk"
      :open="isWizardOpen"
      :ask="activeAsk"
      @close="isWizardOpen = false"
    />
  </div>
</template>

<style scoped>
/* Bottom-right, same position discipline as the approval notifier: visible
   and answerable from any view, without covering the titlebar or content. */
.ask-notifier {
  position: fixed;
  bottom: 16px;
  right: 14px;
  z-index: 50;
  width: 340px;
  display: grid;
  align-content: end;
  pointer-events: none;
}

.beside-approvals {
  right: 366px;
}

/* Browser mode: dock left over the chat (the native page webview owns the
   right and draws above all HTML). Beside-approvals flips with it. */
.dock-start {
  right: auto;
  left: 14px;
}

.dock-start.beside-approvals {
  right: auto;
  left: 366px;
}

.toast {
  pointer-events: auto;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--t-slow) var(--ease-out),
    transform var(--t-slow) var(--ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
