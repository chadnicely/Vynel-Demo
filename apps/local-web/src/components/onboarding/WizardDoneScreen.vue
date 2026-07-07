<script setup lang="ts">
const props = defineProps<{
  displayName: string | null;
}>();

const emit = defineEmits<{
  open: [];
}>();
</script>

<template>
  <div class="done">
    <h1 class="done-title">
      You're all set<template v-if="props.displayName"
        >, {{ props.displayName }}</template
      >.
    </h1>
    <p class="done-body">
      Your assistant is ready. Say hello in the chat — it already knows where
      to start.
    </p>
    <button type="button" class="open-app" @click="emit('open')">
      Open Vynel
    </button>
  </div>
</template>

<style scoped>
.done {
  display: grid;
  justify-items: center;
  gap: 8px;
  text-align: center;
  padding: 26px 8px 18px;
}

.done-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 20px/1.35 var(--font-ui);
}

.done-body {
  margin: 0 0 12px;
  max-width: 380px;
  color: var(--ink-2);
  font: 400 13px/1.6 var(--font-ui);
}

.open-app {
  appearance: none;
  border: 0;
  border-radius: var(--radius-s);
  padding: 9px 26px;
  background: var(--gold);
  color: #14171c;
  font: 600 13.5px/1.6 var(--font-ui);
  transition: background var(--t-fast) var(--ease-out);
}

.open-app:hover {
  background: var(--gold-bright);
}
</style>
