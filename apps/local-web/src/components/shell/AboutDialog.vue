<script setup lang="ts">
import { ref, watch } from "vue";
import {
  PhArrowsClockwise as RefreshCw,
  PhDiamondsFour as DiamondsFour,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import { useShellUpdater } from "../../composables/shell/use-shell-updater.js";

// About Vynel (the Vynel menu, 2026-08-27): the version this computer runs
// and the one update action the gold update flow leaves to the user — updates
// download on their own every four hours; here you can ask right now. A ready
// update offers the same restart the pill does; nothing here is ever a modal
// interruption, the user opened it themselves.
const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ close: [] }>();

const updater = useShellUpdater();

type CheckState = "idle" | "checking" | "current" | "failed" | "unavailable";
const checkState = ref<CheckState>("idle");

// A re-opened dialog asks fresh — last visit's "You're up to date" may no
// longer be true.
watch(
  () => props.open,
  (open) => {
    if (open) checkState.value = "idle";
  },
);

async function checkNow() {
  if (checkState.value === "checking") return;
  checkState.value = "checking";
  const outcome = await updater.checkNow();
  // "ready" flips pendingVersion, which swaps this block for the restart one.
  checkState.value = outcome === "ready" ? "idle" : outcome;
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal :open="open" title="About Vynel" size="sm" @update:open="onOpenChange">
    <div class="grid justify-items-center gap-1 py-3 text-center">
      <span class="mb-1 grid size-10 place-items-center rounded-md text-[var(--color-accent)]">
        <DiamondsFour :size="28" weight="regular" />
      </span>
      <p class="text-[14px] font-semibold text-ink-1">Vynel</p>
      <p class="text-[12px] text-ink-2" data-test="about-version">
        {{
          updater.appVersion.value !== null
            ? `Version ${updater.appVersion.value}`
            : "Development build"
        }}
      </p>

      <!-- The update block: a downloaded update offers the pill's restart;
           otherwise one button asks the shell to check right now. -->
      <div class="mt-3 grid justify-items-center gap-2">
        <template v-if="updater.pendingVersion.value !== null">
          <p class="text-[12px] text-ink-2" data-test="about-ready">
            Version {{ updater.pendingVersion.value }} is downloaded and ready.
          </p>
          <button
            type="button"
            class="update-action"
            :disabled="updater.installing.value"
            data-test="about-restart"
            @click="updater.installNow()"
          >
            <RefreshCw :size="12" aria-hidden="true" />
            {{ updater.installing.value ? "Restarting…" : "Restart to update" }}
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="update-action"
            :disabled="checkState === 'checking'"
            data-test="about-check"
            @click="checkNow()"
          >
            <RefreshCw :size="12" aria-hidden="true" />
            {{ checkState === "checking" ? "Checking…" : "Check for updates" }}
          </button>
          <p v-if="checkState === 'current'" class="text-[12px] text-ink-3" data-test="about-current">
            You're up to date.
          </p>
          <p v-else-if="checkState === 'failed'" class="text-[12px] text-ink-3" data-test="about-failed">
            Couldn't check for updates — try again.
          </p>
          <p v-else-if="checkState === 'unavailable'" class="text-[12px] text-ink-3" data-test="about-unavailable">
            Updates aren't available in this build.
          </p>
        </template>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.update-action {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-raised);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.update-action:hover:not(:disabled) {
  border-color: var(--gold);
}

.update-action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.update-action:disabled {
  opacity: 0.7;
}

.update-action svg {
  color: var(--ink-3);
}
</style>
