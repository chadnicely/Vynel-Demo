<script setup lang="ts">
import { computed, ref } from "vue";
import type { ServerInstallResponse } from "@vynel/contracts/server-install/server-install-http";
import { useRemoveServerInstall } from "../../composables/server-install/use-remove-server-install.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// One provisioned (or provisioning, or failed) engine install. While a run is
// in flight the row narrates its step in plain language — the daemon stamps
// the step, this only names it.

const props = defineProps<{ install: ServerInstallResponse; isActive: boolean }>();
const emit = defineEmits<{ use: [installId: string] }>();

const remove = useRemoveServerInstall();
const isRemoveArmed = ref(false);

const STEP_LABELS: Record<string, string> = {
  connect: "Connecting to the server",
  preflight: "Checking the server",
  upload: "Sending Vynel's engine",
  install: "Installing",
  start: "Starting it up",
  health: "Making sure it answers",
};

const statusLine = computed(() => {
  const install = props.install;
  if (install.status === "provisioning") {
    return install.step ? `${STEP_LABELS[install.step] ?? install.step}…` : "Getting started…";
  }
  if (install.status === "failed") return install.errorMessage ?? "Something went wrong.";
  return install.installedVersion
    ? `Ready — running Vynel ${install.installedVersion}`
    : "Ready";
});

const removeError = computed(() =>
  remove.error.value ? formatSdkError(remove.error.value) : null,
);

function requestRemove() {
  if (!isRemoveArmed.value) {
    isRemoveArmed.value = true;
    return;
  }
  isRemoveArmed.value = false;
  remove.mutate({ installId: props.install.id });
}
</script>

<template>
  <div class="row group flex flex-col gap-1 rounded-lg border border-hair bg-raised p-3">
    <div class="flex items-center gap-2">
      <span class="text-[13px] font-semibold text-ink-1">
        {{ props.install.username }}@{{ props.install.host }}
      </span>
      <span
        v-if="props.isActive"
        class="active-chip rounded-sm bg-gold px-1.5 py-0.5 text-[10px] font-semibold uppercase text-shell"
      >
        In use
      </span>
      <span
        v-else-if="props.install.status === 'failed'"
        class="is-danger rounded-sm border border-danger px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger"
      >
        Failed
      </span>
    </div>

    <p class="status-line m-0 text-xs text-ink-2">{{ statusLine }}</p>

    <div class="flex items-center gap-2 pt-1">
      <button
        v-if="props.install.status === 'installed' && !props.isActive"
        class="use-button cursor-default rounded-sm bg-gold px-3 py-1 text-[11px] font-semibold text-shell transition hover:bg-gold-bright"
        @click="emit('use', props.install.id)"
      >
        Run Vynel here
      </button>
      <button
        v-if="props.install.status !== 'provisioning'"
        class="remove-button cursor-default rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1"
        @click="requestRemove"
        @blur="isRemoveArmed = false"
      >
        {{ isRemoveArmed ? "Sure?" : "Forget" }}
      </button>
    </div>

    <p v-if="removeError" class="m-0 text-xs text-danger" role="alert">{{ removeError }}</p>
  </div>
</template>
