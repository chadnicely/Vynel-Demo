<script setup lang="ts">
import { Activity } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";

function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const greeting = greetingForHour(new Date().getHours());
</script>

<template>
  <div class="home-view">
    <header class="home-header">
      <h1 class="greeting">{{ greeting }}</h1>
      <p class="promise">Everything your assistant does shows up here.</p>
    </header>

    <section class="activity-card">
      <EmptyState
        title="No activity yet"
        hint="Start in Chat — ask for anything, and every task, file change, and approval lands on this dashboard as it happens."
      >
        <template #icon>
          <Activity :size="22" />
        </template>
      </EmptyState>
    </section>
  </div>
</template>

<style scoped>
.home-view {
  height: 100%;
  overflow-y: auto;
  padding: 48px 32px;
  max-width: 880px;
  margin: 0 auto;
}

.home-header {
  margin-bottom: 24px;
}

.greeting {
  margin: 0;
  color: var(--ink-1);
  font: 600 28px/1.3 var(--font-ui);
  letter-spacing: -0.01em;
}

.promise {
  margin: 4px 0 0;
  color: var(--ink-2);
  font: 400 13.5px/1.6 var(--font-ui);
}

.activity-card {
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
}
</style>
