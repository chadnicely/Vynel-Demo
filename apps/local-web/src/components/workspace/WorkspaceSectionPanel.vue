<script setup lang="ts">
import { computed } from "vue";
import {
  Blocks,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  ListChecks,
  NotebookText,
  Radio,
  Server,
  Sparkles,
  SquarePlay,
} from "lucide-vue-next";
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import AgentsSection from "../sections/AgentsSection.vue";
import AppsSection from "../sections/AppsSection.vue";
import ChannelsSection from "../sections/ChannelsSection.vue";
import KnowledgeSection from "../sections/KnowledgeSection.vue";
import LockedFeatureCard from "../sections/LockedFeatureCard.vue";
import MarketplaceSection from "../sections/MarketplaceSection.vue";
import MemorySection from "../sections/MemorySection.vue";
import NotebookSection from "../sections/NotebookSection.vue";
import SchedulesSection from "../sections/SchedulesSection.vue";
import SshServersSection from "../sections/SshServersSection.vue";
import TasksSection from "../sections/TasksSection.vue";
import PlansSection from "../sections/PlansSection.vue";
import JournalSection from "../sections/JournalSection.vue";
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
  tasks: ListChecks,
  apps: SquarePlay,
  "ssh-servers": Server,
  knowledge: BookOpen,
  marketplace: Blocks,
  memory: Brain,
  notebook: NotebookText,
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

// Tier gating: a locked section renders the upgrade card in place of its
// component — the drawer item stays visible, so the lock is discoverable.
const { isLocked } = useHubFeatures();

// Skills fetch only while theirs is the active drawer panel — the composable
// passes `enabled` through to vue-query, so the inactive read stays idle.
const skillsQuery = useInstalledSkills(
  () => props.workspaceId,
  computed(() => props.section === "skills"),
);

const skills = computed(() => skillsQuery.data.value ?? []);
</script>

<template>
  <!-- Channels/schedules/knowledge/memory have their own scope-aware sections
       (they also serve the global menu); the panel hosts them directly. -->
  <ChannelsSection
    v-if="props.section === 'channels'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <template v-else-if="props.section === 'schedules'">
    <LockedFeatureCard v-if="isLocked('schedules')" feature-label="Schedules" />
    <SchedulesSection
      v-else
      :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
    />
  </template>
  <!-- Tasks/Plans/Journal are core assistant plumbing (like notebook) — no tier gate. -->
  <TasksSection
    v-else-if="props.section === 'tasks'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <PlansSection
    v-else-if="props.section === 'plans'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <JournalSection
    v-else-if="props.section === 'journal'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <template v-else-if="props.section === 'apps'">
    <LockedFeatureCard v-if="isLocked('apps')" feature-label="Apps" />
    <AppsSection v-else :workspace-id="props.workspaceId" />
  </template>
  <template v-else-if="props.section === 'ssh-servers'">
    <LockedFeatureCard v-if="isLocked('ssh')" feature-label="Servers" />
    <SshServersSection
      v-else
      :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
    />
  </template>
  <template v-else-if="props.section === 'knowledge'">
    <LockedFeatureCard v-if="isLocked('knowledge')" feature-label="Knowledge" />
    <KnowledgeSection
      v-else
      :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
    />
  </template>
  <template v-else-if="props.section === 'memory'">
    <LockedFeatureCard v-if="isLocked('memory')" feature-label="Memory" />
    <MemorySection
      v-else
      :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
    />
  </template>
  <!-- Notebook is core assistant guidance — no tier gate. -->
  <NotebookSection
    v-else-if="props.section === 'notebook'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <!-- Agents (like notebook): core delegation surface — no tier gate. -->
  <AgentsSection
    v-else-if="props.section === 'agents'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />

  <template v-else-if="props.section === 'marketplace'">
    <!-- A locked marketplace never asks for rows the daemon would answer
         with 403 — the section only mounts once the feature is unlocked. -->
    <LockedFeatureCard
      v-if="isLocked('marketplace')"
      feature-label="Marketplace"
    />
    <MarketplaceSection
      v-else
      :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
    />
  </template>

  <div v-else class="section-panel">
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

    <!-- Skills — the only section still hosted inline. Installed means
         present on disk (install/uninstall-only) — no On/Off state. -->
    <div class="rows">
      <div v-for="skill in skills" :key="skill.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ skill.definition?.displayName ?? skill.skillId }}
          </p>
          <p class="row-sub">
            {{ skill.definition?.oneLineDescription ?? "" }}
          </p>
        </div>
      </div>
    </div>
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
</style>
