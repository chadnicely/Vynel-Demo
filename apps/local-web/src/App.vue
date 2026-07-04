<script setup lang="ts">
import TitleBar from "./components/shell/TitleBar.vue";
import ApprovalNotifier from "./components/shell/ApprovalNotifier.vue";
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <main class="app-body">
      <RouterView />
    </main>
    <ApprovalNotifier />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: 40px 1fr;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

.app-body {
  min-height: 0;
  overflow: hidden;
}
</style>
