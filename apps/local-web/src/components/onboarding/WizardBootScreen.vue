<script setup lang="ts">
// The pre-snapshot moment: either the start/status calls are resolving, or
// one of them failed and the user needs a way out — this is the first screen
// a fresh install ever shows, so it must never hang silently.
const props = defineProps<{
  error: string | null;
}>();

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div class="boot">
    <p v-if="props.error" class="boot-error">{{ props.error }}</p>
    <p v-else class="boot-note">Waking your assistant…</p>
    <button v-if="props.error" type="button" class="retry" @click="emit('retry')">
      Try again
    </button>
  </div>
</template>

<style scoped>
.boot {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 40px 0 32px;
}

.boot-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 13px/1.6 var(--font-ui);
}

.boot-error {
  margin: 0;
  color: var(--danger);
  font: 400 12.5px/1.6 var(--font-ui);
}

.retry {
  appearance: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  padding: 6px 16px;
  font: 600 12px/1.6 var(--font-ui);
}

.retry:hover {
  background: var(--row-hover);
}
</style>
