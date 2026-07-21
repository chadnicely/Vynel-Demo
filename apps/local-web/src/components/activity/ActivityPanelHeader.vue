<script setup lang="ts">
import { ArrowLeft, Square, X } from "lucide-vue-next";
import { IconButton, PresenceDot } from "@vynel/ui";

// The activity panel's header strip — purely presentational: identity (live
// dot + title + context), the trace-only job pill, and the Back/Stop/Close
// affordances. The panel derives every prop from the node stack + monitor.
const props = defineProps<{
  title: string;
  context: string;
  isLive: boolean;
  /** Back's accessible label — null hides the button (stack depth one). */
  backLabel: string | null;
  /** The job pill (trace base, list view only) — null hides it. */
  statusLabel: string | null;
  statusTone: "live" | "ok" | "danger" | null;
  showStop: boolean;
}>();

const emit = defineEmits<{
  back: [];
  stop: [];
  close: [];
}>();
</script>

<template>
  <header class="viewer-header">
    <IconButton
      v-if="props.backLabel !== null"
      :label="props.backLabel"
      @click="emit('back')"
    >
      <ArrowLeft :size="15" />
    </IconButton>
    <div class="titles">
      <p class="viewer-title">
        <PresenceDot :state="props.isLive ? 'live' : 'idle'" />
        {{ props.title }}
        <span
          v-if="props.statusLabel !== null"
          class="status-pill"
          :class="props.statusTone ? `is-${props.statusTone}` : ''"
        >
          {{ props.statusLabel }}
        </span>
      </p>
      <p class="viewer-context">{{ props.context }}</p>
    </div>
    <IconButton v-if="props.showStop" label="Stop this task" @click="emit('stop')">
      <Square :size="13" />
    </IconButton>
    <IconButton label="Close" @click="emit('close')">
      <X :size="15" />
    </IconButton>
  </header>
</template>

<style scoped>
.viewer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hair);
}

.titles {
  flex: 1;
  min-width: 0;
}

.viewer-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-context {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill {
  flex: none;
  padding: 1px 8px;
  border-radius: 99px;
  border: 1px solid var(--hair-strong);
  color: var(--ink-2);
  font: 600 10px/1.5 var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-pill.is-live {
  border-color: var(--gold-soft);
  background: var(--gold-soft);
  color: var(--gold);
  animation: pill-breathe 1.6s var(--ease-out) infinite;
}

@keyframes pill-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-pill.is-live {
    animation: none;
  }
}

.status-pill.is-ok {
  border-color: transparent;
  background: color-mix(in srgb, var(--ok) 16%, transparent);
  color: var(--ok);
}

.status-pill.is-danger {
  border-color: transparent;
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}
</style>
