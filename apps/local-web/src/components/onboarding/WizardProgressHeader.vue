<script setup lang="ts">
const props = defineProps<{
  order: number;
  totalSteps: number;
  completedStepCount: number;
  displayLabel: string;
  oneLineDescription: string;
}>();
</script>

<template>
  <div class="progress-header">
    <div class="progress" role="status">
      <span class="progress-count">
        Step {{ props.order }} of {{ props.totalSteps }}
      </span>
      <span class="dots" aria-hidden="true">
        <span
          v-for="dotIndex in props.totalSteps"
          :key="dotIndex"
          class="dot"
          :class="{
            'is-done': dotIndex <= props.completedStepCount,
            'is-current': dotIndex === props.order,
          }"
        ></span>
      </span>
    </div>

    <h1 class="step-title">{{ props.displayLabel }}</h1>
    <p class="step-description">{{ props.oneLineDescription }}</p>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.progress-count {
  color: var(--ink-3);
  font: 500 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.dots {
  display: flex;
  gap: 5px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hair-strong);
  transition: background var(--t-slow) var(--ease-out);
}

.dot.is-done {
  background: var(--gold);
}

.dot.is-current {
  background: var(--gold-bright);
  outline: 3px solid var(--gold-soft);
}

.step-title {
  margin: 0 0 4px;
  color: var(--ink-1);
  font: 600 19px/1.35 var(--font-ui);
}

.step-description {
  margin: 0 0 18px;
  color: var(--ink-3);
  font: 400 12.5px/1.55 var(--font-ui);
}
</style>
