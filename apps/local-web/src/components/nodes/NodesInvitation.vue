<script setup lang="ts">
// The quiet word over a lit stage. It sits BELOW the core so the orb stays the
// hero — an empty stage read as broken, a lit one reads as new.
defineProps<{ title: string; copy: string; cta: string; showsPlus?: boolean }>();
const emit = defineEmits<{ act: [] }>();
</script>

<template>
  <div class="invitation">
    <h1 class="title">{{ title }}</h1>
    <p class="copy">{{ copy }}</p>
    <button type="button" class="cta" @click="emit('act')">
      <svg
        v-if="showsPlus"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M8 3v10M3 8h10"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      {{ cta }}
    </button>
  </div>
</template>

<style scoped>
.invitation {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 1;
  transform: translate(-50%, 0);
  margin-top: 76px;
  width: min(460px, 82%);
  display: grid;
  justify-items: center;
  text-align: center;
  pointer-events: none;
}

.title {
  margin: 0 0 8px;
  color: var(--ink-1);
  font: 600 21px/1.3 var(--font-ui);
}

.copy {
  margin: 0;
  color: var(--ink-2);
  font: 400 13px/1.65 var(--font-ui);
}

.cta {
  appearance: none;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 22px;
  padding: 9px 18px;
  border-radius: var(--radius-m);
  border: 1px solid var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
  font: 500 12.5px var(--font-ui);
  cursor: pointer;
  transition: box-shadow 160ms var(--ease-out);
}
.cta:hover {
  box-shadow: 0 0 22px rgba(145, 132, 217, 0.3);
}
</style>
