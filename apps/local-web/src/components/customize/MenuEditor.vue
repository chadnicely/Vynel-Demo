<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhArrowDown as ArrowDown,
  PhArrowUp as ArrowUp,
  PhEye as Eye,
  PhEyeSlash as EyeOff,
  PhPlus as Plus,
  PhX as X,
} from "@phosphor-icons/vue";
import {
  WORKSPACE_SECTIONS,
  type WorkspaceSectionId,
} from "../workspace/workspace-sections.js";
import { useCustomizeStore } from "../../stores/customize-store.js";

// The sidebar layout editor, for either scope: the flat entry list IS the
// menu, top to bottom — what you see here is exactly what renders
// (consecutive same-group runs get one header). Hiding is visual only; the
// agent keeps every tool. `excludeSectionIds` drops rows the scope never
// shows (the Global menu has no Apps).
const props = defineProps<{
  scopeKey: string;
  excludeSectionIds?: WorkspaceSectionId[];
}>();

const store = useCustomizeStore();

const config = computed(() => store.customizationFor(props.scopeKey));
const visibleEntries = computed(() => {
  const excluded = new Set(props.excludeSectionIds ?? []);
  return config.value.entries.filter(
    (entry) => !excluded.has(entry.sectionId),
  );
});

const SECTION_LABELS = new Map(
  WORKSPACE_SECTIONS.map((section) => [section.id, section.label]),
);

function sectionLabel(sectionId: WorkspaceSectionId): string {
  return SECTION_LABELS.get(sectionId) ?? sectionId;
}

function onGroupPicked(sectionId: WorkspaceSectionId, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  store.setGroup(props.scopeKey, sectionId, value === "" ? null : value);
}

const newGroupLabel = ref("");

function addGroup() {
  const label = newGroupLabel.value.trim();
  if (label.length === 0) return;
  store.addGroup(props.scopeKey, label);
  newGroupLabel.value = "";
}

function onGroupRenamed(groupId: string, event: Event) {
  const label = (event.target as HTMLInputElement).value.trim();
  if (label.length === 0) return;
  store.renameGroup(props.scopeKey, groupId, label);
}

const selectClass =
  "h-6 cursor-default rounded-sm border border-hair bg-raised px-1.5 text-xs text-ink-2 transition hover:border-hair-strong focus:outline-none";
const iconButtonClass =
  "grid size-6 shrink-0 cursor-default place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-30 disabled:hover:bg-transparent";
</script>

<template>
  <div class="menu-editor flex flex-col gap-4">
    <!-- The layout, exactly as the sidebar will render it -->
    <ul class="m-0 flex list-none flex-col gap-px p-0">
      <li
        v-for="(entry, index) in visibleEntries"
        :key="entry.sectionId"
        class="entry-row flex items-center gap-2 rounded-sm px-1.5 py-1"
        :class="entry.isHidden ? 'opacity-45' : ''"
      >
        <div class="flex shrink-0">
          <button
            type="button"
            :class="iconButtonClass"
            :disabled="index === 0"
            :aria-label="`Move ${sectionLabel(entry.sectionId)} up`"
            @click="
              store.moveEntry(
                props.scopeKey,
                entry.sectionId,
                -1,
                props.excludeSectionIds,
              )
            "
          >
            <ArrowUp :size="13" />
          </button>
          <button
            type="button"
            :class="iconButtonClass"
            :disabled="index === visibleEntries.length - 1"
            :aria-label="`Move ${sectionLabel(entry.sectionId)} down`"
            @click="
              store.moveEntry(
                props.scopeKey,
                entry.sectionId,
                1,
                props.excludeSectionIds,
              )
            "
          >
            <ArrowDown :size="13" />
          </button>
        </div>
        <span class="min-w-0 flex-1 truncate text-sm text-ink-1">
          {{ sectionLabel(entry.sectionId) }}
        </span>
        <select
          :class="selectClass"
          :value="entry.groupId ?? ''"
          :aria-label="`Group for ${sectionLabel(entry.sectionId)}`"
          @change="(event) => onGroupPicked(entry.sectionId, event)"
        >
          <option value="">No group</option>
          <option
            v-for="group in config.groups"
            :key="group.id"
            :value="group.id"
          >
            {{ group.label }}
          </option>
        </select>
        <button
          type="button"
          :class="iconButtonClass"
          :aria-label="
            entry.isHidden
              ? `Show ${sectionLabel(entry.sectionId)}`
              : `Hide ${sectionLabel(entry.sectionId)}`
          "
          @click="
            store.setHidden(props.scopeKey, entry.sectionId, !entry.isHidden)
          "
        >
          <EyeOff v-if="entry.isHidden" :size="14" />
          <Eye v-else :size="14" />
        </button>
      </li>
    </ul>

    <!-- Group catalog: rename in place, delete (sections fall back to
         standalone), add new -->
    <div class="flex flex-col gap-1.5">
      <p class="m-0 text-2xs font-semibold uppercase tracking-wider text-ink-3">
        Groups
      </p>
      <div
        v-for="group in config.groups"
        :key="group.id"
        class="flex items-center gap-2"
      >
        <input
          type="text"
          maxlength="60"
          :value="group.label"
          :aria-label="`Rename group ${group.label}`"
          class="h-7 min-w-0 flex-1 rounded-sm border border-hair bg-raised px-2 text-sm text-ink-1 transition focus:border-hair-strong focus:outline-none"
          @change="(event) => onGroupRenamed(group.id, event)"
        />
        <button
          type="button"
          :class="iconButtonClass"
          :aria-label="`Delete group ${group.label}`"
          @click="store.removeGroup(props.scopeKey, group.id)"
        >
          <X :size="14" />
        </button>
      </div>
      <form class="flex items-center gap-2" @submit.prevent="addGroup">
        <input
          v-model="newGroupLabel"
          type="text"
          maxlength="60"
          placeholder="New group name"
          aria-label="New group name"
          class="h-7 min-w-0 flex-1 rounded-sm border border-hair bg-raised px-2 text-sm text-ink-1 placeholder:text-ink-3 transition focus:border-hair-strong focus:outline-none"
        />
        <button
          type="submit"
          class="inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        >
          <Plus :size="13" />
          Add group
        </button>
      </form>
    </div>
  </div>
</template>
