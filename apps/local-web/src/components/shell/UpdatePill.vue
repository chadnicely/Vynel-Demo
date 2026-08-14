<script setup lang="ts">
import { PhArrowsClockwise as RefreshCw } from "@phosphor-icons/vue";
import { useShellUpdater } from "../../composables/shell/use-shell-updater.js";

// The unobtrusive "restart to update" pill (gold update flow): the shell
// downloaded the update in the background; this floats bottom-right until the
// user restarts on their own terms. Never a modal, never gold (gold =
// presence). Renders nothing in a browser tab or while no update waits.
const updater = useShellUpdater();
</script>

<template>
  <Transition name="update-pill">
    <button
      v-if="updater.pendingVersion.value !== null"
      type="button"
      class="update-pill"
      :disabled="updater.installing.value"
      @click="updater.installNow()"
    >
      <RefreshCw :size="12" aria-hidden="true" />
      {{
        updater.installing.value
          ? "Restarting…"
          : `Update ready — Restart`
      }}
    </button>
  </Transition>
</template>

<style scoped>
.update-pill {
  appearance: none;
  position: fixed;
  right: 16px;
  bottom: 40px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-raised);
  box-shadow: var(--shadow-raised);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
}

.update-pill:hover:not(:disabled) {
  border-color: var(--gold);
}

.update-pill:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.update-pill:disabled {
  opacity: 0.7;
}

.update-pill svg {
  color: var(--ink-3);
}

.update-pill-enter-active,
.update-pill-leave-active {
  transition:
    opacity var(--t-fast) var(--ease-out),
    translate var(--t-fast) var(--ease-out);
}

.update-pill-enter-from,
.update-pill-leave-to {
  opacity: 0;
  translate: 0 6px;
}

@media (prefers-reduced-motion: reduce) {
  .update-pill-enter-active,
  .update-pill-leave-active {
    transition: none;
  }
}
</style>
