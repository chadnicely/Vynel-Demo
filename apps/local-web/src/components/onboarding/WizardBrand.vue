<script setup lang="ts">
// The card's header: the breathing gold orb + the wordmark. Its own file so
// the wizard container stays about the run, not the chrome.
</script>

<template>
  <header class="brand">
    <span class="orb" aria-hidden="true"></span>
    <span class="wordmark">Vynel</span>
  </header>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.orb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 35% 35%,
    var(--gold-bright),
    var(--gold) 70%
  );
  box-shadow: 0 0 10px var(--gold-soft);
  animation: orb-breathe 3.2s var(--ease-out) infinite;
}

@keyframes orb-breathe {
  0%,
  100% {
    box-shadow: 0 0 6px var(--gold-soft);
  }
  50% {
    box-shadow: 0 0 14px var(--gold-soft);
  }
}

@media (prefers-reduced-motion: reduce) {
  .orb {
    animation: none;
  }
}

.wordmark {
  color: var(--ink-2);
  font: 600 12px/1 var(--font-ui);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
</style>
