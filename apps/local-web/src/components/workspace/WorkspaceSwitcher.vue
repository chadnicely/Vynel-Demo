<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ChevronsUpDown, FolderOpen } from "lucide-vue-next";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";

const props = defineProps<{
  workspaces: WorkspaceResponse[];
  activeWorkspaceId: string | null;
}>();

const emit = defineEmits<{
  select: [workspaceId: string];
}>();

const isOpen = ref(false);
const rootElement = ref<HTMLElement | null>(null);

// Dropdown etiquette: clicking anywhere else closes the menu.
function onDocumentPointerDown(event: PointerEvent) {
  if (!isOpen.value) return;
  if (rootElement.value?.contains(event.target as Node)) return;
  isOpen.value = false;
}

onMounted(() =>
  document.addEventListener("pointerdown", onDocumentPointerDown),
);
onUnmounted(() =>
  document.removeEventListener("pointerdown", onDocumentPointerDown),
);

const activeWorkspace = computed(
  () =>
    props.workspaces.find((row) => row.id === props.activeWorkspaceId) ?? null,
);

function select(workspaceId: string) {
  isOpen.value = false;
  emit("select", workspaceId);
}
</script>

<template>
  <div ref="rootElement" class="workspace-switcher">
    <button
      type="button"
      class="trigger"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <FolderOpen :size="14" class="trigger-icon" />
      <span class="trigger-name">{{
        activeWorkspace?.name ?? "Pick a workspace"
      }}</span>
      <ChevronsUpDown :size="13" class="trigger-caret" />
    </button>

    <div v-if="isOpen" class="menu">
      <button
        v-for="workspace in props.workspaces"
        :key="workspace.id"
        type="button"
        class="menu-row"
        :class="{ 'is-active': workspace.id === props.activeWorkspaceId }"
        @click="select(workspace.id)"
      >
        <span class="menu-name">{{ workspace.name }}</span>
        <span v-if="workspace.managerName" class="menu-manager">
          {{ workspace.managerName }} is handling it
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.workspace-switcher {
  position: relative;
  flex: 1;
  min-width: 0;
}

.trigger {
  appearance: none;
  border: 0;
  margin: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-s);
  background: transparent;
  cursor: default;
}

.trigger:hover {
  background: var(--row-hover);
}

.trigger:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.trigger-icon {
  color: var(--ink-3);
  flex: none;
}

.trigger-name {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-caret {
  color: var(--ink-3);
  margin-left: auto;
  flex: none;
}

.menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bg-raised);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  box-shadow: var(--shadow-overlay);
  padding: 4px;
  display: grid;
  gap: 2px;
}

.menu-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  gap: 1px;
  padding: 6px 8px;
  border-radius: 5px;
  background: transparent;
  text-align: left;
  cursor: default;
}

.menu-row:hover {
  background: var(--row-hover);
}

.menu-row.is-active {
  background: var(--row-active);
}

.menu-name {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
}

.menu-manager {
  color: var(--ink-3);
  font: 400 11px/1.4 var(--font-ui);
}
</style>
