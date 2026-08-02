<script setup lang="ts">
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import AgentsSection from "../sections/AgentsSection.vue";
import AppsSection from "../sections/AppsSection.vue";
import ChannelsSection from "../sections/ChannelsSection.vue";
import CommandsSection from "../sections/CommandsSection.vue";
import KnowledgeSection from "../sections/KnowledgeSection.vue";
import LockedFeatureCard from "../sections/LockedFeatureCard.vue";
import MarketplaceSection from "../sections/MarketplaceSection.vue";
import McpServersSection from "../sections/McpServersSection.vue";
import MemorySection from "../sections/MemorySection.vue";
import NotebookSection from "../sections/NotebookSection.vue";
import RulesSection from "../sections/RulesSection.vue";
import SchedulesSection from "../sections/SchedulesSection.vue";
import SkillsSection from "../sections/SkillsSection.vue";
import SshServersSection from "../sections/SshServersSection.vue";
import TasksSection from "../sections/TasksSection.vue";
import PlansSection from "../sections/PlansSection.vue";
import JournalSection from "../sections/JournalSection.vue";
import type { WorkspaceSectionId } from "./workspace-sections.js";

// The drawer panel is pure dispatch now: every section id has a dedicated
// scope-aware component (skills was the last inline holdout — extracted to
// SkillsSection with the config-surfaces move).
const props = defineProps<{
  section: WorkspaceSectionId;
  workspaceId: string;
}>();

// Tier gating: a locked section renders the upgrade card in place of its
// component — the drawer item stays visible, so the lock is discoverable.
const { isLocked } = useHubFeatures();
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
  <!-- Claude-config surfaces (rules/commands/mcp): core plumbing — no tier gate. -->
  <RulesSection
    v-else-if="props.section === 'rules'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <CommandsSection
    v-else-if="props.section === 'commands'"
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
  <McpServersSection
    v-else-if="props.section === 'mcp-servers'"
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

  <SkillsSection
    v-else
    :scope="{ kind: 'workspace', workspaceId: props.workspaceId }"
  />
</template>
