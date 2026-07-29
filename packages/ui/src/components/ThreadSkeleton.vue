<script setup lang="ts">
// The conversation-loading state — ghost message rows with a soft shimmer, so
// an opening thread never flashes blank (or worse, flashes the welcome hero)
// while its history fetch is in flight. Purely decorative: fixed row recipe,
// no props, sized to read as "a conversation is coming".
</script>

<template>
  <div class="thread-skeleton" role="status" aria-label="Loading conversation">
    <div v-for="row in 4" :key="row" class="ghost-row">
      <span class="ghost-label" />
      <span class="ghost-line" :class="`w-${row}`" />
      <span v-if="row % 2 === 0" class="ghost-line short" />
    </div>
  </div>
</template>

<style scoped>
.thread-skeleton {
  display: grid;
  gap: 26px;
  padding: 28px 0;
  max-width: 968px;
  margin: 0 auto;
  width: 100%;
}

.ghost-row {
  display: grid;
  gap: 10px;
}

.ghost-label,
.ghost-line {
  border-radius: 6px;
  background: linear-gradient(
    100deg,
    var(--bg-inset, rgba(127, 127, 127, 0.12)) 40%,
    var(--bg-hover, rgba(127, 127, 127, 0.22)) 50%,
    var(--bg-inset, rgba(127, 127, 127, 0.12)) 60%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

.ghost-label {
  width: 72px;
  height: 10px;
  opacity: 0.7;
}

.ghost-line {
  height: 13px;
}

.ghost-line.w-1 {
  width: 46%;
}
.ghost-line.w-2 {
  width: 82%;
}
.ghost-line.w-3 {
  width: 64%;
}
.ghost-line.w-4 {
  width: 74%;
}
.ghost-line.short {
  width: 38%;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ghost-label,
  .ghost-line {
    animation: none;
  }
}
</style>
