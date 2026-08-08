<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SlidersHorizontal } from "lucide-vue-next";
import { WorkspaceColorPicker } from "@vynel/ui";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useUpdateWorkspace } from "../../composables/workspaces/use-update-workspace.js";
import { useCustomizeStore } from "../../stores/customize-store.js";
import SectionHeader from "../sections/SectionHeader.vue";
import MenuEditor from "./MenuEditor.vue";
import PersonaIconPicker from "./PersonaIconPicker.vue";
import WorkspaceIconPicker from "./WorkspaceIconPicker.vue";

// The workspace's Customize canvas: who runs this room (name, persona,
// accent color) and how its menu reads (the layout editor). Names save
// through the API — they're real workspace fields; color and layout are
// local presentation and apply instantly.
const props = defineProps<{
  workspaceId: string;
}>();

const workspacesQuery = useWorkspaceList();
const updateWorkspace = useUpdateWorkspace();
const store = useCustomizeStore();

const workspace = computed(() =>
  (workspacesQuery.data.value ?? []).find(
    (candidate) => candidate.id === props.workspaceId,
  ),
);

const nameDraft = ref("");
const personaDraft = ref("");

// Drafts follow the loaded row (and reloads after a save) — but never
// mid-edit: only reseed when the source row actually changes.
watch(
  workspace,
  (row) => {
    if (row === undefined) return;
    nameDraft.value = row.name;
    personaDraft.value = row.managerName ?? "";
  },
  { immediate: true },
);

const isDirty = computed(
  () =>
    workspace.value !== undefined &&
    (nameDraft.value.trim() !== workspace.value.name ||
      personaDraft.value.trim() !== (workspace.value.managerName ?? "")),
);

function save() {
  const row = workspace.value;
  const name = nameDraft.value.trim();
  const persona = personaDraft.value.trim();
  if (row === undefined || name.length === 0 || updateWorkspace.isPending.value)
    return;
  updateWorkspace.mutate({
    workspaceId: props.workspaceId,
    ...(name !== row.name ? { name } : {}),
    ...(persona.length > 0 && persona !== (row.managerName ?? "")
      ? { managerName: persona }
      : {}),
  });
}

const colorSlot = computed(
  () => store.customizationFor(props.workspaceId).colorSlot,
);

const inputClass =
  "h-8 w-full rounded-sm border border-hair bg-raised px-2.5 text-sm text-ink-1 transition focus:border-hair-strong focus:outline-none";
const cardClass = "rounded-lg border border-hair bg-panel p-3.5";
</script>

<template>
  <div class="customize-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SlidersHorizontal"
      title="Customize"
      subtitle="Make this workspace yours — its persona, its color, its menu"
    >
      <template #actions>
        <button
          v-if="store.isCustomized(props.workspaceId)"
          type="button"
          class="reset-button inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="store.reset(props.workspaceId)"
        >
          Reset menu &amp; color
        </button>
      </template>
    </SectionHeader>

    <!-- Persona & look -->
    <div :class="cardClass">
      <p class="m-0 pb-2.5 text-sm font-semibold text-ink-1">Persona</p>
      <div class="flex flex-col gap-2.5">
        <label class="flex flex-col gap-1 text-xs text-ink-2">
          Workspace name
          <input v-model="nameDraft" type="text" :class="inputClass" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink-2">
          Persona name
          <input
            v-model="personaDraft"
            type="text"
            :class="inputClass"
            placeholder="Sarah"
          />
        </label>
        <p class="m-0 text-2xs text-ink-3">
          The persona name is how you @-mention this workspace from any chat —
          renaming it changes the mention too.
        </p>
        <PersonaIconPicker :scope-key="props.workspaceId" />
        <WorkspaceIconPicker
          :workspace-id="props.workspaceId"
          :workspace-name="nameDraft"
        />
        <div class="flex items-center justify-between">
          <WorkspaceColorPicker
            :selected-slot="colorSlot"
            label="Accent color"
            @pick="(slot) => store.setColorSlot(props.workspaceId, slot)"
          />
          <button
            type="button"
            class="save-button inline-flex shrink-0 cursor-default items-center rounded-full border border-hair-strong bg-raised px-3.5 py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-40"
            :disabled="!isDirty || updateWorkspace.isPending.value"
            @click="save"
          >
            {{ updateWorkspace.isPending.value ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Menu layout -->
    <div :class="cardClass">
      <p class="m-0 pb-0.5 text-sm font-semibold text-ink-1">Menu</p>
      <p class="m-0 pb-2.5 text-xs text-ink-2">
        Choose what shows in this workspace's menu and how it's grouped.
        Hiding a menu never limits what Claude can do — it only tidies the
        list.
      </p>
      <MenuEditor :scope-key="props.workspaceId" />
    </div>
  </div>
</template>
