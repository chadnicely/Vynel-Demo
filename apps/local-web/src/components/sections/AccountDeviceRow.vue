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
  <div class="row">
    <span class="row-icon">
      <MonitorSmartphone :size="14" />
    </span>
    <div class="row-main">
      <p class="row-title">
        {{ props.device.deviceName }}
        <span class="platform-chip">{{ props.device.devicePlatform }}</span>
      </p>
      <p class="row-sub">
        v{{ props.device.appVersion }} · last used
        {{ formatRelativeTime(props.device.lastUsedAt) }}
      </p>
    </div>
    <template v-if="isArmed">
      <button type="button" class="row-action" @click="isArmed = false">
        Keep
      </button>
      <button
        type="button"
        class="row-action is-danger"
        @click="confirmRevoke"
      >
        Confirm
      </button>
    </template>
    <button
      v-else
      type="button"
      class="row-action"
      :disabled="props.isRevoking"
      @click="isArmed = true"
    >
      {{ props.isRevoking ? "Revoking…" : "Revoke" }}
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  flex: none;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.platform-chip {
  color: var(--ink-2);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair);
  border-radius: 99px;
  padding: 0 6px;
  background: var(--bg-panel);
}

.row-action {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.row-action:hover:not(:disabled) {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.row-action:disabled {
  opacity: 0.55;
}

.row-action.is-danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.row-action.is-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.row-action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
