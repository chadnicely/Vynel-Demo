<script setup lang="ts">
import { computed } from "vue";
import { Wrench } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The skills shelf on either surface (extracted from the workspace drawer's
// last inline list): a workspace drawer shows the installs made INTO that
// room; the global menu the user-scope shelf. Each list mirrors what is on
// disk at that scope — a session there still reaches both. Installed means
// present on disk (install/uninstall-only — no On/Off state); install and
// uninstall stay in the Marketplace. Read-only here.
const props = defineProps<{
  scope: SectionScope;
}>();

const skillsQuery = useInstalledSkills(() => props.scope);
const skills = computed(() => skillsQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "What Claude knows how to do, in every workspace"
    : "Skills installed into this workspace",
);
</script>

<template>
  <div class="skills-section flex flex-col gap-2.5">
    <SectionHeader :icon="Wrench" title="Skills" :subtitle="sectionHint" />

    <div v-if="skills.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ok/10 text-ok"
        >
          <Wrench :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ skill.definition?.displayName ?? skill.skillId }}
            </p>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(skill.workspaceId) }}</span
            >
            <span
              v-if="skill.installHealth !== 'healthy'"
              class="health-chip inline-flex shrink-0 items-center rounded-full border border-danger/40 px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-danger"
              >Needs attention</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ skill.definition?.oneLineDescription ?? "" }}
          </p>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      title="No skills yet"
      hint="Install a skill from the Marketplace and Claude picks it up the moment a task calls for it."
    >
      <template #icon>
        <Wrench :size="22" />
      </template>
    </EmptyState>
  </div>
</template>
