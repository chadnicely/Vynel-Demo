<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, SquarePlay } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useWorkspaceApps } from "../../composables/workspace-apps/use-workspace-apps.js";
import AppFormDialog from "../apps/AppFormDialog.vue";
import AppRow from "../apps/AppRow.vue";
import SectionHeader from "./SectionHeader.vue";

// The workspace's runnable apps — the dev servers Claude registered or the
// user added. Workspace-only by design: an app needs a folder to run in, so
// (unlike Tasks) there is no global twin of this section.
const props = defineProps<{
  workspaceId: string;
}>();

const appsQuery = useWorkspaceApps(() => props.workspaceId);
const apps = computed(() => appsQuery.data.value ?? []);

// One dialog serves both doors: `editingApp` null means add, a row means edit.
const isFormOpen = ref(false);
const editingApp = ref<WorkspaceAppResponse | null>(null);

function openAdd() {
  editingApp.value = null;
  isFormOpen.value = true;
}

function openEdit(app: WorkspaceAppResponse) {
  editingApp.value = app;
  isFormOpen.value = true;
}
</script>

<template>
  <div class="apps-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SquarePlay"
      title="Apps"
      subtitle="The apps this project runs — start them and watch what they print"
    >
      <template v-if="apps.length > 0" #actions>
        <button
          type="button"
          class="add-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="openAdd"
        >
          <Plus :size="13" />
          Add app
        </button>
      </template>
    </SectionHeader>

    <div v-if="apps.length > 0" class="rows flex flex-col gap-2">
      <AppRow
        v-for="app in apps"
        :key="app.id"
        :app="app"
        :workspace-id="props.workspaceId"
        @edit="openEdit(app)"
      />
    </div>

    <EmptyState
      v-else
      title="No apps yet"
      hint="Add the app this project runs — or ask Claude to set it up — then start it and watch it from here."
    >
      <template #icon>
        <SquarePlay :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="openAdd"
        >
          <Plus :size="13" />
          Add app
        </button>
      </template>
    </EmptyState>

    <AppFormDialog
      :open="isFormOpen"
      :workspace-id="props.workspaceId"
      :app="editingApp"
      @close="isFormOpen = false"
      @saved="isFormOpen = false"
    />
  </div>
</template>
