<script setup lang="ts">
// The one home for step-shared presentation: form fields, intro copy, choice
// cards, optional tags. Steps stay markup-only — they use these class names
// and never restyle them (the duplication would drift).
</script>

<template>
  <div class="step-body">
    <slot />
  </div>
</template>

<style scoped>
.step-body :deep(.field) {
  display: grid;
  gap: 5px;
  margin-bottom: 12px;
}

.step-body :deep(.field-row) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.step-body :deep(.field-label) {
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
}

.step-body :deep(.field-hint) {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.step-body :deep(input[type="text"]),
.step-body :deep(input[type="password"]),
.step-body :deep(select),
.step-body :deep(textarea) {
  appearance: none;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--ink-1);
  padding: 8px 10px;
  font: 400 13px/1.5 var(--font-ui);
  transition: border-color var(--t-fast) var(--ease-out);
}

.step-body :deep(textarea) {
  resize: vertical;
  min-height: 60px;
}

.step-body :deep(input:focus-visible),
.step-body :deep(select:focus-visible),
.step-body :deep(textarea:focus-visible) {
  outline: none;
  border-color: var(--gold);
}

.step-body :deep(input::placeholder),
.step-body :deep(textarea::placeholder) {
  color: var(--ink-3);
}

.step-body :deep(.explain) {
  margin: 0 0 16px;
  color: var(--ink-2);
  font: 400 13px/1.6 var(--font-ui);
}

.step-body :deep(.optional-tag) {
  margin-left: 6px;
  color: var(--ink-3);
  font: 400 10.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.step-body :deep(.choice-cards) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.step-body :deep(.choice) {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.step-body :deep(.choice.is-active) {
  border-color: var(--gold);
}

.step-body :deep(.choice input) {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

/* The radio itself is hidden — keyboard focus must show on the card. */
.step-body :deep(.choice:has(input:focus-visible)) {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.step-body :deep(.choice-title) {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.step-body :deep(.choice-body) {
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}
</style>
