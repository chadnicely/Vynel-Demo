<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { WORKSPACE_KIND_BUNDLES } from "@vynel/contracts/workspaces/workspace-kind-bundles";
import { workspaceAccentVar, workspaceMonogram } from "@vynel/ui";

// The workspace room's arrival moment — the same hero language as the global
// chat's, wearing this workspace's identity instead of Claude's: the room's
// monogram ("VY" for vynel) in the workspace accent, the workspace name as
// the wordmark, the persona as the greeting.
const props = defineProps<{
  workspace: WorkspaceResponse;
}>();

const accent = computed(() => workspaceAccentVar(props.workspace.name));

const monogram = computed(() => workspaceMonogram(props.workspace.name));

const headline = computed(() =>
  props.workspace.managerName
    ? `${props.workspace.managerName} is on ${props.workspace.name}.`
    : `Welcome to ${props.workspace.name}.`,
);

const kindLabel = computed(
  () => WORKSPACE_KIND_BUNDLES[props.workspace.kind].displayName,
);
</script>

<template>
  <section class="workspace-hero" :style="{ '--accent': accent }">
    <div class="hero-mark">
      <span class="mark-initial">{{ monogram }}</span>
    </div>

    <p class="hero-wordmark">{{ props.workspace.name }}</p>
    <p class="hero-greeting">{{ headline }}</p>
    <p class="hero-line">
      {{ kindLabel }} workspace — ask for anything in this room; its files,
      tools, and history stay right here.
    </p>
  </section>
</template>

<style scoped>
.workspace-hero {
  display: grid;
  justify-items: center;
  width: 100%;
  max-width: 620px;
  padding: 32px 24px;
}

/* The room's mark — its monogram in the workspace accent, the same halo
   treatment as the global hero's spark. Never gold. */
.hero-mark {
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--accent) 16%, transparent) 0%,
    transparent 70%
  );
  animation: hero-rise 600ms var(--ease-out) both;
}

.mark-initial {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
  color: var(--accent);
  font: 600 21px/1 var(--font-display);
  letter-spacing: 0.03em;
}

.hero-wordmark {
  margin: 20px 0 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
  animation: hero-rise 500ms var(--ease-out) 80ms both;
}

.hero-greeting {
  margin: 6px 0 0;
  color: var(--ink-1);
  font: 300 30px/1.25 var(--font-display);
  letter-spacing: -0.01em;
  text-align: center;
  animation: hero-rise 500ms var(--ease-out) 140ms both;
}

.hero-line {
  margin: 10px 0 0;
  max-width: 60ch;
  text-align: center;
  color: var(--ink-2);
  font: 400 13px/1.6 var(--font-ui);
  animation: hero-rise 500ms var(--ease-out) 200ms both;
}

@keyframes hero-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-mark,
  .hero-wordmark,
  .hero-greeting,
  .hero-line {
    animation: none;
  }
}
</style>
