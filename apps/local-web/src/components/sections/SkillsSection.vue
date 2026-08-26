<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhPencilSimple as Pencil,
  PhPlus as Plus,
  PhWrench as Wrench,
  PhX as X,
} from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useUninstallSkill } from "../../composables/skills/use-skill-file-mutations.js";
import { skillScopeOf } from "../../composables/skills/skill-scope.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import EditSkillFilesDialog from "./EditSkillFilesDialog.vue";
import WriteSkillDialog from "./WriteSkillDialog.vue";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The skills shelf on either surface: a workspace drawer shows the installs
// made INTO that room; the global menu the user-scope shelf. Each list
// mirrors what is on disk at that scope — the engine syncs the rows with
// the folder on every read, so a skill dropped in by hand appears (source
// "On disk") and a deleted one reads "Needs attention". Installed means
// present on disk (install/uninstall-only — no On/Off state). Here the user
// writes their own skills, opens any skill's files, and uninstalls.
const props = defineProps<{
  scope: SectionScope;
}>();

const skillsQuery = useInstalledSkills(() => props.scope);
const skills = computed(() => skillsQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();
const uninstallSkill = useUninstallSkill();

// Provenance chip per source. Vynel-written skills wear none — "yours" is
// the default; the chip marks what arrived from elsewhere.
const SOURCE_LABELS: Record<string, string> = {
  "verified-catalog": "Curated",
  marketplace: "Marketplace",
  external: "On disk",
};

const isWriteOpen = ref(false);
const editingSkillId = ref<string | null>(null);

function startWriting() {
  isWriteOpen.value = true;
}

function onSaved(skillId: string) {
  isWriteOpen.value = false;
  editingSkillId.value = skillId;
}

// Uninstall removes the folder for good — the armed X idiom.
const armedUninstallId = ref<string | null>(null);

function requestUninstall(skill: { id: string; skillId: string }) {
  if (armedUninstallId.value !== skill.id) {
    armedUninstallId.value = skill.id;
    return;
  }
  armedUninstallId.value = null;
  uninstallSkill.mutate({ skillId: skill.skillId, query: skillScopeOf(props.scope) });
}

function disarmUninstall(id: string) {
  if (armedUninstallId.value === id) armedUninstallId.value = null;
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "What Claude knows how to do, in every workspace"
    : "Skills installed into this workspace",
);
</script>

<template>
  <div class="skills-section flex flex-col gap-2.5">
    <SectionHeader :icon="Wrench" title="Skills" :subtitle="sectionHint">
      <template v-if="skills.length > 0" #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a skill
        </button>
      </template>
    </SectionHeader>

    <div v-if="skills.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <button
          type="button"
          class="row-open flex min-w-0 flex-1 cursor-default items-center gap-3 border-0 bg-transparent p-0 text-left"
          @click="editingSkillId = skill.skillId"
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
                v-if="SOURCE_LABELS[skill.installedFromSource]"
                class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
                >{{ SOURCE_LABELS[skill.installedFromSource] }}</span
              >
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
              {{ skill.definition?.oneLineDescription ?? skill.skillId }}
            </p>
          </div>
        </button>
        <button
          type="button"
          class="icon-button edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Open ${skill.skillId}`"
          :aria-label="`Open ${skill.skillId}`"
          @click="editingSkillId = skill.skillId"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedUninstallId === skill.id
              ? 'row-action uninstall-button is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button uninstall-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :title="
            armedUninstallId === skill.id
              ? `Confirm uninstall ${skill.skillId}`
              : `Uninstall ${skill.skillId}`
          "
          :aria-label="
            armedUninstallId === skill.id
              ? `Confirm uninstall ${skill.skillId}`
              : `Uninstall ${skill.skillId}`
          "
          @click="requestUninstall(skill)"
          @blur="disarmUninstall(skill.id)"
        >
          <template v-if="armedUninstallId === skill.id">Sure?</template>
          <X v-else :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No skills yet"
      hint="Skills are things Claude knows how to do — write one here, or install one from the Marketplace."
    >
      <template #icon>
        <Wrench :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a skill
        </button>
      </template>
    </EmptyState>

    <WriteSkillDialog
      :open="isWriteOpen"
      :default-scope="props.scope"
      @close="isWriteOpen = false"
      @saved="onSaved"
    />
    <EditSkillFilesDialog
      :open="editingSkillId !== null"
      :scope="props.scope"
      :skill-id="editingSkillId"
      @close="editingSkillId = null"
    />
  </div>
</template>
