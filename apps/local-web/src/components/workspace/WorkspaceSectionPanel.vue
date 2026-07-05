<script setup lang="ts">
import { computed } from "vue";
import {
  Blocks,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  Radio,
  Sparkles,
} from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useChannels } from "../../composables/channels/use-channels.js";
import { useSchedules } from "../../composables/schedules/use-schedules.js";
import { useKnowledgeSources } from "../../composables/knowledge/use-knowledge-sources.js";
import { useMarketplaceItems } from "../../composables/marketplace/use-marketplace-items.js";
import { WORKSPACE_SECTIONS } from "./workspace-sections.js";
import type {
  WorkspaceSectionId,
  WorkspaceSectionMeta,
} from "./workspace-sections.js";

const props = defineProps<{
  section: WorkspaceSectionId;
  workspaceId: string;
}>();

const SECTION_ICONS = {
  skills: Sparkles,
  channels: Radio,
  schedules: CalendarClock,
  knowledge: BookOpen,
  marketplace: Blocks,
  memory: Brain,
  agents: Bot,
} as const;

const FALLBACK_META: WorkspaceSectionMeta = {
  id: "skills",
  label: "Section",
  hint: "",
};

const sectionMeta = computed(
  () =>
    WORKSPACE_SECTIONS.find((row) => row.id === props.section) ?? FALLBACK_META,
);

// Each section fetches only while it's the active drawer panel — the composable
// passes `enabled` through to vue-query, so the four inactive reads stay idle.
const workspaceId = () => props.workspaceId;

const skillsQuery = useInstalledSkills(
  workspaceId,
  computed(() => props.section === "skills"),
);
const channelsQuery = useChannels(
  computed(() => props.section === "channels"),
);
const schedulesQuery = useSchedules(
  computed(() => props.section === "schedules"),
);
const knowledgeQuery = useKnowledgeSources(
  workspaceId,
  computed(() => props.section === "knowledge"),
);
const marketplaceQuery = useMarketplaceItems(
  workspaceId,
  computed(() => props.section === "marketplace"),
);

const skills = computed(() => skillsQuery.data.value ?? []);
const knowledgeSources = computed(() => knowledgeQuery.data.value ?? []);
const marketplaceItems = computed(() => marketplaceQuery.data.value ?? []);

const channels = computed(() =>
  (channelsQuery.data.value ?? []).filter(
    (row) => row.workspaceId === null || row.workspaceId === props.workspaceId,
  ),
);

const schedules = computed(() =>
  (schedulesQuery.data.value ?? []).filter(
    (row) => row.workspaceId === null || row.workspaceId === props.workspaceId,
  ),
);

function scheduleTiming(nextFireAt: string | null): string {
  if (!nextFireAt) return "not scheduled";
  return `next ${new Date(nextFireAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// Knowledge sources carry only an absolute path — the folder's last segment is
// the friendliest label the real wire can offer.
function folderName(absolutePath: string): string {
  const segments = absolutePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? absolutePath;
}
</script>

<template>
  <div class="section-panel">
    <header class="section-header">
      <component
        :is="SECTION_ICONS[props.section]"
        :size="15"
        class="section-icon"
      />
      <div>
        <p class="section-title">{{ sectionMeta.label }}</p>
        <p class="section-hint">{{ sectionMeta.hint }}</p>
      </div>
    </header>

    <!-- Skills -->
    <div v-if="props.section === 'skills'" class="rows">
      <div v-for="skill in skills" :key="skill.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ skill.definition?.displayName ?? skill.skillId }}
          </p>
          <p class="row-sub">{{ skill.definition?.oneLineDescription ?? "" }}</p>
        </div>
        <span class="pill" :class="skill.isEnabled ? 'is-on' : 'is-off'">
          {{ skill.isEnabled ? "On" : "Off" }}
        </span>
      </div>
    </div>

    <!-- Channels -->
    <div v-else-if="props.section === 'channels'" class="rows">
      <div v-for="channel in channels" :key="channel.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ channel.displayName }}
            <span v-if="channel.workspaceId === null" class="scope-chip"
              >Global</span
            >
          </p>
          <p class="row-sub">
            {{
              channel.connectionStatus === "healthy"
                ? "Connected and listening"
                : (channel.connectionStatusMessage ?? channel.connectionStatus)
            }}
          </p>
        </div>
        <span
          class="pill"
          :class="channel.connectionStatus === 'healthy' ? 'is-on' : 'is-warn'"
        >
          {{ channel.connectionStatus === "healthy" ? "Healthy" : "Attention" }}
        </span>
      </div>
    </div>

    <!-- Schedules -->
    <div v-else-if="props.section === 'schedules'" class="rows">
      <div v-for="schedule in schedules" :key="schedule.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ schedule.displayName }}
            <span v-if="schedule.workspaceId === null" class="scope-chip"
              >Global</span
            >
          </p>
          <p class="row-sub">
            {{ schedule.scheduleKind === "one-time" ? "One time" : "Repeats" }}
            ·
            {{ scheduleTiming(schedule.nextScheduledFireAt) }}
          </p>
        </div>
        <span class="pill" :class="schedule.isEnabled ? 'is-on' : 'is-off'">
          {{ schedule.isEnabled ? "On" : "Paused" }}
        </span>
      </div>
    </div>

    <!-- Knowledge -->
    <div v-else-if="props.section === 'knowledge'" class="rows">
      <div v-for="source in knowledgeSources" :key="source.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ folderName(source.absolutePath) }}
            <span v-if="source.scope === 'global'" class="scope-chip"
              >Global</span
            >
          </p>
          <p class="row-sub">
            {{ source.absolutePath }} · updated
            {{ formatRelativeTime(source.updatedAt) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Marketplace -->
    <div v-else-if="props.section === 'marketplace'" class="rows">
      <div v-for="item in marketplaceItems" :key="item.itemId" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ item.displayName }}
            <span v-if="item.isOfficial" class="scope-chip is-gold"
              >Official</span
            >
          </p>
          <p class="row-sub">{{ item.oneLineDescription }}</p>
        </div>
        <span
          class="pill"
          :class="item.installStatus.kind === 'installed' ? 'is-on' : 'is-off'"
        >
          {{ item.installStatus.kind === "installed" ? "Installed" : "Get" }}
        </span>
      </div>
    </div>

    <!-- Memory / Agents — arrive with their APIs -->
    <EmptyState
      v-else
      :title="`${sectionMeta.label} is on its way`"
      :hint="`${sectionMeta.hint} — this section lights up when its backend lands.`"
    />
  </div>
</template>

<style scoped>
.section-panel {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

.scope-chip.is-gold {
  color: var(--gold);
  border-color: var(--gold-soft);
  background: var(--gold-soft);
}

.pill {
  flex: none;
  font: 600 11px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 10px;
}

.pill.is-on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill.is-off {
  color: var(--ink-3);
  background: var(--row-active);
}

.pill.is-warn {
  color: var(--gold);
  background: var(--gold-soft);
}
</style>
