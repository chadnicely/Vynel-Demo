<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Mic } from "lucide-vue-next";
import type { ChannelResponse } from "@vynel/contracts/channels/channel-http";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { WORKSPACE_KIND_BUNDLES } from "@vynel/contracts/workspaces/workspace-kind-bundles";
import { ClaudeMark, workspaceAccentVar } from "@vynel/ui";
import { greetingForHour } from "../../utils/greeting.js";
import ChannelBrandIcon from "../channels/ChannelBrandIcon.vue";
import {
  channelConnectionNote,
  isChannelHealthy,
} from "../channels/channel-catalog.js";

// The arrival moment — the global chat's face while the thread is empty. The
// assistant presents itself (the spark + its name + a time-aware personal
// greeting), then its command deck: the channels it's reachable on and the
// workspaces it runs — each wearing that workspace's accent with its manager
// persona. This is the ONLY chrome; a flowing thread is just the conversation.
const props = defineProps<{
  assistantName: string;
  /** The user's first name for the greeting, or null while unknown. */
  userFirstName: string | null;
  channels: ChannelResponse[];
  workspaces: WorkspaceResponse[];
}>();

const emit = defineEmits<{
  openWorkspace: [workspaceId: string];
}>();

const greeting = computed(() => {
  const phrase = greetingForHour(new Date().getHours());
  return props.userFirstName
    ? `${phrase}, ${props.userFirstName}.`
    : `${phrase}.`;
});

const reachable = computed(() =>
  props.channels.filter((channel) => channel.isEnabled),
);

function workspaceNote(workspace: WorkspaceResponse): string {
  return workspace.managerName
    ? `With ${workspace.managerName}`
    : WORKSPACE_KIND_BUNDLES[workspace.kind].displayName;
}
</script>

<template>
  <section class="welcome-hero">
    <div class="hero-mark">
      <ClaudeMark :size="72" class="hero-mark-glyph" />
    </div>

    <p class="hero-wordmark">{{ props.assistantName }}</p>
    <p class="hero-greeting">{{ greeting }}</p>
    <p class="hero-line">
      One conversation for everything — ask below, or say “Hey
      {{ props.assistantName }}”.
    </p>

    <div class="deck">
      <section class="deck-group">
        <p class="deck-label">Reachable on</p>
        <ul class="deck-cards">
          <li v-for="channel in reachable" :key="channel.id">
            <div class="deck-card">
              <span class="card-icon">
                <ChannelBrandIcon :kind="channel.channelKind" :size="14" />
              </span>
              <span class="card-text">
                <span class="card-name">{{ channel.displayName }}</span>
                <span class="card-note">{{
                  channelConnectionNote(channel)
                }}</span>
              </span>
              <span
                class="status-dot"
                :class="isChannelHealthy(channel) ? 'is-ok' : 'is-warn'"
              />
            </div>
          </li>
          <li>
            <div class="deck-card">
              <span class="card-icon"><Mic :size="14" /></span>
              <span class="card-text">
                <span class="card-name">Voice</span>
                <span class="card-note"
                  >Say “Hey {{ props.assistantName }}”</span
                >
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section class="deck-group">
        <p class="deck-label">Your workspaces</p>
        <ul class="deck-cards">
          <li v-for="workspace in props.workspaces" :key="workspace.id">
            <button
              type="button"
              class="deck-card is-workspace"
              :style="{ '--accent': workspaceAccentVar(workspace.name) }"
              @click="emit('openWorkspace', workspace.id)"
            >
              <span class="card-accent" />
              <span class="card-text">
                <span class="card-name">{{ workspace.name }}</span>
                <span class="card-note">{{ workspaceNote(workspace) }}</span>
              </span>
              <ChevronRight :size="13" class="card-chevron" />
            </button>
          </li>
          <li v-if="props.workspaces.length === 0">
            <div class="deck-card is-empty">
              <span class="card-text">
                <span class="card-name">No workspaces yet</span>
                <span class="card-note"
                  >Ask {{ props.assistantName }} to set one up.</span
                >
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.welcome-hero {
  display: grid;
  justify-items: center;
  width: 100%;
  max-width: 620px;
  padding: 32px 24px;
}

/* The spark sits in its own soft halo and breathes, barely — the identity
   mark carries the arrival, so everything else stays quiet. */
.hero-mark {
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--claude-mark-soft) 0%,
    transparent 70%
  );
  animation: hero-rise 600ms var(--ease-out) both;
}

.hero-mark-glyph {
  animation: mark-breathe 6s var(--ease-out) infinite;
}

@keyframes mark-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}

.hero-wordmark {
  margin: 20px 0 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.34em;
  /* Re-center the tracked caps: letter-spacing trails the last glyph. */
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

.deck {
  margin-top: 36px;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 22px 24px;
  align-items: start;
}

.deck-group:nth-of-type(1) {
  animation: hero-rise 500ms var(--ease-out) 280ms both;
}

.deck-group:nth-of-type(2) {
  animation: hero-rise 500ms var(--ease-out) 340ms both;
}

.deck-label {
  margin: 0 0 8px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.deck-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.deck-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
  text-align: left;
}

button.deck-card {
  appearance: none;
  margin: 0;
  cursor: default;
  transition:
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    transform var(--t-fast) var(--ease-out);
}

/* A workspace card wears its identity accent — a tinted frame + halo dot.
   Gold never appears here: workspace identity is the --ws-* palette. */
.deck-card.is-workspace {
  border-color: color-mix(in srgb, var(--accent) 32%, transparent);
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-panel));
}

.deck-card.is-workspace:hover {
  border-color: color-mix(in srgb, var(--accent) 65%, transparent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-raised);
}

.deck-card.is-workspace:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.deck-card.is-empty {
  border-style: dashed;
  background: transparent;
}

.card-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--ink-2);
  flex: none;
}

.card-accent {
  width: 8px;
  height: 8px;
  margin: 0 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  flex: none;
}

.card-text {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.card-name {
  color: var(--ink-1);
  font: 600 12.5px/1.4 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-note {
  color: var(--ink-3);
  font: 400 11px/1.4 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-chevron {
  color: var(--ink-3);
  flex: none;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-3);
  flex: none;
}

.status-dot.is-ok {
  background: var(--ok);
}

.status-dot.is-warn {
  background: var(--gold);
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
  .hero-mark-glyph,
  .hero-wordmark,
  .hero-greeting,
  .hero-line,
  .deck-group {
    animation: none;
  }
}
</style>
