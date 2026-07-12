<script setup lang="ts">
import { computed, ref } from "vue";
import { MessageSquare, Plus, Radio, Send, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useChannels } from "../../composables/channels/use-channels.js";
import { useDisconnectChannel } from "../../composables/channels/use-disconnect-channel.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import ConnectChannelDialog from "./ConnectChannelDialog.vue";
import type { SectionScope } from "./section-scope.js";

// The channels section, on either surface: the global menu shows every
// channel the assistant is reachable on; a workspace drawer shows that room's
// plus the global ones. Connecting is the point — the empty state invites it.
const props = defineProps<{
  scope: SectionScope;
}>();

const channelsQuery = useChannels(true);
const { scopeLabel } = useScopeLabel();

const channels = computed(() => {
  const rows = channelsQuery.data.value ?? [];
  if (props.scope.kind === "global") return rows;
  const workspaceId = props.scope.workspaceId;
  return rows.filter(
    (row) => row.workspaceId === null || row.workspaceId === workspaceId,
  );
});

function statusNote(channel: {
  connectionStatus: string;
  connectionStatusMessage: string | null;
}): string {
  return channel.connectionStatus === "healthy"
    ? "Connected and listening"
    : (channel.connectionStatusMessage ?? channel.connectionStatus);
}

const KIND_ICONS = { telegram: Send, discord: MessageSquare } as const;

const isConnectOpen = ref(false);

function onConnected() {
  isConnectOpen.value = false;
}

// Disconnecting is irreversible — the bot token must be re-entered to
// reconnect — so, per the AccountDeviceRow / Notebook idiom, the X arms
// first ("Sure?"), only a second explicit click fires, and blur disarms.
const disconnect = useDisconnectChannel();
const armedDisconnectId = ref<string | null>(null);

function requestDisconnect(channelId: string) {
  if (armedDisconnectId.value !== channelId) {
    armedDisconnectId.value = channelId;
    return;
  }
  armedDisconnectId.value = null;
  disconnect.mutate({ channelId });
}

function disarmDisconnect(channelId: string) {
  if (armedDisconnectId.value === channelId) armedDisconnectId.value = null;
}
</script>

<template>
  <div class="channels-section">
    <header class="section-header">
      <Radio :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Channels</p>
        <p class="section-hint">Telegram and other ways to reach Claude</p>
      </div>
      <button
        v-if="channels.length > 0"
        type="button"
        class="add-button"
        @click="isConnectOpen = true"
      >
        <Plus :size="13" />
        Connect
      </button>
    </header>

    <div v-if="channels.length > 0" class="rows">
      <div v-for="channel in channels" :key="channel.id" class="row">
        <span class="row-icon">
          <component :is="KIND_ICONS[channel.channelKind]" :size="14" />
        </span>
        <div class="row-main">
          <p class="row-title">
            {{ channel.displayName }}
            <span class="scope-chip">{{ scopeLabel(channel.workspaceId) }}</span>
          </p>
          <p class="row-sub">{{ statusNote(channel) }}</p>
        </div>
        <span
          class="pill"
          :class="channel.connectionStatus === 'healthy' ? 'is-on' : 'is-warn'"
        >
          {{ channel.connectionStatus === "healthy" ? "Healthy" : "Attention" }}
        </span>
        <button
          type="button"
          :class="
            armedDisconnectId === channel.id
              ? 'row-action is-danger'
              : 'icon-button'
          "
          :title="
            armedDisconnectId === channel.id
              ? `Confirm disconnect ${channel.displayName}`
              : `Disconnect ${channel.displayName}`
          "
          :aria-label="
            armedDisconnectId === channel.id
              ? `Confirm disconnect ${channel.displayName}`
              : `Disconnect ${channel.displayName}`
          "
          @click="requestDisconnect(channel.id)"
          @blur="disarmDisconnect(channel.id)"
        >
          <template v-if="armedDisconnectId === channel.id">Sure?</template>
          <X v-else :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No channels yet"
      hint="Connect Telegram and message Claude from your phone — same brain, same memory, approvals included."
    >
      <template #icon>
        <Radio :size="22" />
      </template>
      <template #action>
        <button type="button" class="invite-button" @click="isConnectOpen = true">
          <Plus :size="13" />
          Connect Telegram
        </button>
      </template>
    </EmptyState>

    <ConnectChannelDialog
      :open="isConnectOpen"
      :default-scope="props.scope"
      @close="isConnectOpen = false"
      @connected="onConnected"
    />
  </div>
</template>

<style scoped>
.channels-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button,
.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

.invite-button {
  border-color: var(--hair-strong);
  background: var(--bg-raised);
  padding: 5px 14px;
}

.add-button:hover,
.invite-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:focus-visible,
.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.rows {
  display: grid;
  gap: 4px;
}

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

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

.pill {
  flex: none;
  font: 600 11px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 10px;
}

.pill.is-on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill.is-warn {
  color: var(--gold);
  background: var(--gold-soft);
}

.icon-button {
  appearance: none;
  margin: 0;
  border: 0;
  padding: 3px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  cursor: default;
  flex: none;
}

.icon-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.icon-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* The armed "Sure?" step borrows the account section's row-action idiom. */
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
