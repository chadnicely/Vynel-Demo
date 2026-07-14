<script setup lang="ts">
import { ref } from "vue";
import { MonitorSmartphone } from "lucide-vue-next";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// Structural subset of the SDK's HubDeviceView — the row only needs these.
interface AccountDeviceView {
  id: string;
  deviceName: string;
  devicePlatform: string;
  appVersion: string;
  lastUsedAt: string;
}

const props = defineProps<{
  device: AccountDeviceView;
  isRevoking: boolean;
}>();

const emit = defineEmits<{
  revoke: [deviceId: string];
}>();

// Revoking is irreversible (the device's session dies at its next contact),
// so the action arms first — only a second, explicit click fires it.
const isArmed = ref(false);

function confirmRevoke() {
  isArmed.value = false;
  emit("revoke", props.device.id);
}
</script>

<template>
  <div
    class="group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
  >
    <span
      class="grid size-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
    >
      <MonitorSmartphone :size="17" />
    </span>
    <div class="min-w-0 flex-1">
      <p
        class="row-title m-0 flex items-center gap-1.5 text-sm font-semibold text-ink-1"
      >
        {{ props.device.deviceName }}
        <span
          class="platform-chip shrink-0 rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.device.devicePlatform }}</span
        >
      </p>
      <p class="m-0 mt-0.5 truncate text-xs text-ink-3">
        v{{ props.device.appVersion }} · last used
        {{ formatRelativeTime(props.device.lastUsedAt) }}
      </p>
    </div>
    <template v-if="isArmed">
      <button
        type="button"
        class="row-action inline-flex shrink-0 cursor-default items-center rounded-full border border-hair-strong px-2.5 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        @click="isArmed = false"
      >
        Keep
      </button>
      <button
        type="button"
        class="row-action is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-2.5 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10"
        @click="confirmRevoke"
      >
        Confirm
      </button>
    </template>
    <button
      v-else
      type="button"
      class="row-action inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-2.5 py-0.5 text-xs font-semibold text-ink-2 opacity-0 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 disabled:opacity-55 group-hover:opacity-100"
      :disabled="props.isRevoking"
      @click="isArmed = true"
    >
      {{ props.isRevoking ? "Revoking…" : "Revoke" }}
    </button>
  </div>
</template>
