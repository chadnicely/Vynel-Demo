<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Blocks,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  NotebookText,
  Radio,
  Sparkles,
} from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useMarketplaceItems } from "../../composables/marketplace/use-marketplace-items.js";
import { useInstallMarketplaceItem } from "../../composables/marketplace/use-install-marketplace-item.js";
import { useUninstallMarketplaceItem } from "../../composables/marketplace/use-uninstall-marketplace-item.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import ChannelsSection from "../sections/ChannelsSection.vue";
import KnowledgeSection from "../sections/KnowledgeSection.vue";
import LockedFeatureCard from "../sections/LockedFeatureCard.vue";
import MemorySection from "../sections/MemorySection.vue";
import NotebookSection from "../sections/NotebookSection.vue";
import SchedulesSection from "../sections/SchedulesSection.vue";
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
const { isLocked, isPro } = useHubFeatures();

// Each section fetches only while it's the active drawer panel — the composable
// passes `enabled` through to vue-query, so the four inactive reads stay idle.
const workspaceId = () => props.workspaceId;

const skillsQuery = useInstalledSkills(
  workspaceId,
  computed(() => props.section === "skills"),
);
// A locked marketplace never asks for rows the daemon would answer with 403.
const marketplaceQuery = useMarketplaceItems(
  workspaceId,
  computed(() => props.section === "marketplace" && !isLocked("marketplace")),
);

const skills = computed(() => skillsQuery.data.value ?? []);
const marketplaceItems = computed(() => marketplaceQuery.data.value ?? []);

// One install mutation drives the whole list; `variables` scopes its pending
// and error state to the row the user actually clicked (AccountSection idiom).
const install = useInstallMarketplaceItem();

function isInstalling(itemId: string): boolean {
  return install.isPending.value && install.variables.value?.itemId === itemId;
}

function installLabel(itemId: string, isInstalled: boolean): string {
  if (isInstalled) return "Installed";
  return isInstalling(itemId) ? "Installing…" : "Get";
}

function installErrorFor(itemId: string): string | null {
  return install.isError.value && install.variables.value?.itemId === itemId
    ? formatSdkError(install.error.value)
    : null;
}

// Removing is irreversible (a skill's settings die with the row; a cloud item
// re-downloads on the next Get) — so, per the AccountDeviceRow / Notebook
// idiom, Remove arms first and only a second explicit click uninstalls.
const uninstall = useUninstallMarketplaceItem();
const armedRemoveItemId = ref<string | null>(null);

function requestRemove(itemId: string) {
  if (armedRemoveItemId.value !== itemId) {
    armedRemoveItemId.value = itemId;
    return;
  }
  armedRemoveItemId.value = null;
  uninstall.mutate({ workspaceId: props.workspaceId, itemId });
}

function disarmRemove(itemId: string) {
  if (armedRemoveItemId.value === itemId) armedRemoveItemId.value = null;
}

function isRemoving(itemId: string): boolean {
  return (
    uninstall.isPending.value && uninstall.variables.value?.itemId === itemId
  );
}

function removeErrorFor(itemId: string): string | null {
  return uninstall.isError.value && uninstall.variables.value?.itemId === itemId
    ? formatSdkError(uninstall.error.value)
    : null;
}
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

  <LockedFeatureCard
    v-else-if="props.section === 'marketplace' && isLocked('marketplace')"
    feature-label="Marketplace"
  />

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

    <!-- Skills -->
    <div v-if="props.section === 'skills'" class="rows">
      <div v-for="skill in skills" :key="skill.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ skill.definition?.displayName ?? skill.skillId }}
          </p>
          <p class="row-sub">
            {{ skill.definition?.oneLineDescription ?? "" }}
          </p>
        </div>
        <span class="pill" :class="skill.isEnabled ? 'is-on' : 'is-off'">
          {{ skill.isEnabled ? "On" : "Off" }}
        </span>
      </div>
    </div>

    <!-- Marketplace -->
    <div v-else-if="props.section === 'marketplace'" class="rows">
      <div v-for="item in marketplaceItems" :key="item.itemId" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ item.displayName }}
            <!-- What you're getting: a skill (a capability) or an agent
                 (a persona) — the Get flow is identical for both. -->
            <span class="scope-chip">{{
              item.kind === "agent" ? "Agent" : "Skill"
            }}</span>
            <span v-if="item.isOfficial" class="scope-chip is-gold"
              >Official</span
            >
            <!-- Display-only: the real install gate is server-side. Shows while
                 the user can't yet install a pro-only item (not on Pro). -->
            <span
              v-if="item.minimumTier === 'pro' && !isPro"
              class="scope-chip is-pro"
              >Pro</span
            >
          </p>
          <p class="row-sub">{{ item.oneLineDescription }}</p>
        </div>
        <!-- Install dispatches cloud vs. bundled server-side; the button just
             names the item. Installed stays disabled (no re-install). -->
        <button
          type="button"
          class="pill"
          :class="item.installStatus.kind === 'installed' ? 'is-on' : 'is-off'"
          :disabled="
            item.installStatus.kind === 'installed' || isInstalling(item.itemId)
          "
          @click="
            install.mutate({
              workspaceId: props.workspaceId,
              itemId: item.itemId,
            })
          "
        >
          {{
            installLabel(item.itemId, item.installStatus.kind === "installed")
          }}
        </button>
        <!-- Removal dispatches by installed kind server-side and flips the
             card back to Get; the arm-then-confirm two-step guards it. -->
        <button
          v-if="item.installStatus.kind === 'installed'"
          type="button"
          class="row-action"
          :class="{ 'is-danger': armedRemoveItemId === item.itemId }"
          :disabled="isRemoving(item.itemId)"
          :aria-label="
            armedRemoveItemId === item.itemId
              ? `Confirm remove ${item.displayName}`
              : `Remove ${item.displayName}`
          "
          @click="requestRemove(item.itemId)"
          @blur="disarmRemove(item.itemId)"
        >
          {{
            armedRemoveItemId === item.itemId
              ? "Sure?"
              : isRemoving(item.itemId)
                ? "Removing…"
                : "Remove"
          }}
        </button>
        <p
          v-if="installErrorFor(item.itemId) || removeErrorFor(item.itemId)"
          class="row-error"
          role="alert"
        >
          {{ installErrorFor(item.itemId) ?? removeErrorFor(item.itemId) }}
        </p>
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
  flex-wrap: wrap;
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

/* Distinct from Official's gold (gold is presence-only) — the informational
   status token reads as "upgrade to reach this". */
.scope-chip.is-pro {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 40%, transparent);
  background: color-mix(in srgb, var(--info) 14%, transparent);
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

button.pill {
  appearance: none;
  margin: 0;
  border: none;
  cursor: default;
  transition: color var(--t-fast) var(--ease-out);
}

button.pill.is-off:hover:not(:disabled) {
  color: var(--ink-1);
}

button.pill:disabled {
  opacity: 0.6;
}

/* The Remove control + its armed "Sure?" step borrow the account section's
   row-action idiom (AccountDeviceRow). */
.row-action {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.row-action:hover:not(:disabled) {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.row-action:disabled {
  opacity: 0.55;
}

.row-action.is-danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.row-action.is-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.row-action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* Wraps to its own line under the row (flex-basis 100%) so an install failure
   reads clearly without shoving the button. */
.row-error {
  flex-basis: 100%;
  margin: 0;
  color: var(--danger);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
