<script setup lang="ts">
import { computed, ref } from "vue";
import { MessageSquare, Plus, Radio, Send, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useChannels } from "../../composables/channels/use-channels.js";
import { useDisconnectChannel } from "../../composables/channels/use-disconnect-channel.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import ConnectChannelDialog from "./ConnectChannelDialog.vue";
import SectionHeader from "./SectionHeader.vue";
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
  <div class="channels-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Radio"
      title="Channels"
      subtitle="Telegram and other ways to reach Claude"
    >
      <template v-if="channels.length > 0" #actions>
        <button
          type="button"
          class="add-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isConnectOpen = true"
        >
          <Plus :size="13" />
          Connect
        </button>
      </template>
    </SectionHeader>

    <div v-if="channels.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="channel in channels"
        :key="channel.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
        >
          <component :is="KIND_ICONS[channel.channelKind]" :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ channel.displayName }}
            </p>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(channel.workspaceId) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ statusNote(channel) }}
          </p>
        </div>
        <span
          class="pill shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          :class="
            channel.connectionStatus === 'healthy'
              ? 'is-on bg-ok/15 text-ok'
              : 'is-warn bg-gold-soft text-gold'
          "
        >
          {{ channel.connectionStatus === "healthy" ? "Healthy" : "Attention" }}
        </span>
        <button
          type="button"
          :class="
            armedDisconnectId === channel.id
              ? 'row-action is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-2.5 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
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
          <X v-else :size="14" />
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
        <button
          type="button"
          class="invite-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="isConnectOpen = true"
        >
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
