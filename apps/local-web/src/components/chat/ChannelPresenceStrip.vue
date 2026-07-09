<script setup lang="ts">
import { computed } from "vue";
import { Mic, MessageSquare, Send } from "lucide-vue-next";
import type {
  ChannelKind,
  ChannelResponse,
} from "@vynel/contracts/channels/channel-http";

// A slim strip atop the global chat: where the assistant is reachable. Telegram
// / Discord come from the user's enabled channels; Voice is always present — the
// assistant's native channel — shown as a capability (the daemon is a separate
// process, so we don't claim a live connection here).
const props = defineProps<{
  channels: ChannelResponse[];
}>();

const CHANNEL_ICONS: Record<ChannelKind, typeof Send> = {
  telegram: Send,
  discord: MessageSquare,
};

const reachable = computed(() =>
  props.channels.filter((channel) => channel.isEnabled),
);
</script>

<template>
  <div class="channel-strip">
    <span class="strip-label">Reachable on</span>
    <div class="chips">
      <span
        v-for="channel in reachable"
        :key="channel.id"
        class="chip"
        :title="channel.connectionStatusMessage ?? channel.connectionStatus"
      >
        <component
          :is="CHANNEL_ICONS[channel.channelKind]"
          :size="13"
          class="chip-icon"
        />
        <span class="chip-name">{{ channel.displayName }}</span>
        <span
          class="status-dot"
          :class="
            channel.connectionStatus === 'healthy' ? 'is-ok' : 'is-warn'
          "
        />
      </span>

      <span class="chip" title="Say “Hey Vynel” to talk">
        <Mic :size="13" class="chip-icon" />
        <span class="chip-name">Voice</span>
        <span class="status-dot is-idle" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.channel-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
  padding: 10px 24px;
}

.strip-label {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  flex: none;
}

.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 10px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 500 11.5px/1.5 var(--font-ui);
}

.chip-icon {
  color: var(--ink-2);
  flex: none;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3);
  flex: none;
}

.status-dot.is-ok {
  background: var(--ok);
}

.status-dot.is-warn {
  background: var(--gold);
}
</style>
