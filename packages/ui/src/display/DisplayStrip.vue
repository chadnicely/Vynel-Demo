<script setup lang="ts">
// The Display's top strip: who you are talking to, whether the link is up, the
// two counters that matter, and the clock. Layout only — the voice controls
// come in through the default slot because they belong to the session, not here.
const props = defineProps<{
  brand: string;
  subtitle: string;
  /** The assistant is reachable — the engine is up and the session is live. */
  linked: boolean;
  /** How many things are working right now. */
  building: number;
  /** How many things are waiting on the user. */
  needYou: number;
  /** Pre-formatted by the host, so the strip never owns a timer. */
  clock: string;
}>();
</script>

<template>
  <header class="display-strip">
    <span class="brand">{{ props.brand }}</span>
    <span class="subtitle">{{ props.subtitle }}</span>
    <span class="pill" :class="{ on: props.linked }">{{
      props.linked ? "Linked" : "Offline"
    }}</span>
    <span class="pill">Building {{ props.building }}</span>
    <span class="pill" :class="{ attention: props.needYou > 0 }"
      >Needs you {{ props.needYou }}</span
    >
    <span class="clock">{{ props.clock }}</span>
    <span class="actions"><slot /></span>
  </header>
</template>

<style scoped>
.display-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
}

.brand {
  letter-spacing: 0.36em;
  text-transform: uppercase;
  color: var(--display-text, #cdf3ff);
  text-shadow: 0 0 12px rgba(79, 216, 255, 0.7);
}

.subtitle {
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill {
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  padding: 2px 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  white-space: nowrap;
}

.pill.on {
  color: #041018;
  background: var(--display-accent, #4fd8ff);
  border-color: var(--display-accent, #4fd8ff);
  box-shadow: 0 0 14px rgba(79, 216, 255, 0.55);
}

.pill.attention {
  color: var(--display-attention, #ffc46b);
  border-color: var(--display-attention, #ffc46b);
}

.clock {
  margin-left: auto;
  color: var(--display-text, #cdf3ff);
  letter-spacing: 0.16em;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
