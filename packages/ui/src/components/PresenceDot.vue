<script setup lang="ts">
// The signature mark: gold = the assistant is alive here.
// idle      — nothing running (quiet, muted dot)
// live      — a task/turn is running (gold, breathing pulse)
// attention — waiting on the user, e.g. a pending approval (gold, steady ring)
const props = withDefaults(
  defineProps<{ state?: "idle" | "live" | "attention"; label?: string }>(),
  {
    state: "idle",
  },
);
</script>

<template>
  <span
    class="presence-dot"
    :class="`is-${props.state}`"
    role="status"
    :aria-label="props.label ?? `assistant ${props.state}`"
  />
</template>

<style scoped>
.presence-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
  flex: none;
}

.is-live {
  background: var(--gold);
  animation: presence-breathe 1.6s var(--ease-out) infinite;
}

.is-attention {
  background: var(--gold);
  box-shadow: 0 0 0 3px var(--gold-soft);
}

@keyframes presence-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 var(--gold-soft);
  }
  50% {
    box-shadow: 0 0 0 4px var(--gold-soft);
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-live {
    animation: none;
    box-shadow: 0 0 0 3px var(--gold-soft);
  }
}
</style>
