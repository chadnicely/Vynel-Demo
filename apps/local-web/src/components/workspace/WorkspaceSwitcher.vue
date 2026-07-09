<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ChevronsUpDown, Plus } from "lucide-vue-next";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { workspaceAccentVar, workspaceMonogram } from "@vynel/ui";

const props = defineProps<{
  workspaces: WorkspaceResponse[];
  activeWorkspaceId: string | null;
}>();

const emit = defineEmits<{
  select: [workspaceId: string];
  create: [];
}>();

const isOpen = ref(false);
const rootElement = ref<HTMLElement | null>(null);

// Dropdown etiquette: clicking anywhere else — or Escape — closes the menu.
function onDocumentPointerDown(event: PointerEvent) {
  if (!isOpen.value) return;
  if (rootElement.value?.contains(event.target as Node)) return;
  isOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!isOpen.value || event.key !== "Escape") return;
  event.preventDefault();
  isOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});

const activeWorkspace = computed(
  () =>
    props.workspaces.find((row) => row.id === props.activeWorkspaceId) ?? null,
);

function select(workspaceId: string) {
  isOpen.value = false;
  emit("select", workspaceId);
}

function create() {
  isOpen.value = false;
  emit("create");
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
      <span
        v-if="activeWorkspace"
        class="trigger-dot"
        :style="{ '--accent': workspaceAccentVar(activeWorkspace.name) }"
      />
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
        :style="{ '--accent': workspaceAccentVar(workspace.name) }"
        @click="select(workspace.id)"
      >
        <span class="row-mark">{{ workspaceMonogram(workspace.name) }}</span>
        <span class="row-text">
          <span class="menu-name">{{ workspace.name }}</span>
          <span v-if="workspace.managerName" class="menu-manager">
            {{ workspace.managerName }} is handling it
          </span>
        </span>
        <svg
          v-if="workspace.id === props.activeWorkspaceId"
          class="row-check"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 8.5l3.5 3.5L13 5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <button type="button" class="menu-row create-row" @click="create">
        <span class="row-mark is-create"><Plus :size="12" /></span>
        <span class="row-text">
          <span class="menu-name is-create-label">New workspace…</span>
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
  gap: 7px;
  padding: 4px 9px;
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

/* The active room's identity, in miniature. */
.trigger-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
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
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 240px;
  max-width: 320px;
  background: var(--bg-raised);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-overlay);
  padding: 5px;
  display: grid;
  gap: 2px;
}

.menu-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: var(--radius-s);
  background: transparent;
  text-align: left;
  cursor: default;
}

.menu-row:hover {
  background: var(--row-hover);
}

.menu-row.is-active {
  background: color-mix(in srgb, var(--accent) 9%, transparent);
}

.menu-row:focus-visible {
  outline: 2px solid var(--accent, var(--gold));
  outline-offset: -2px;
}

/* The room's monogram in its accent (the hero's identity, miniature). The
   create slot wears a dashed placeholder ring. */
.row-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font: 600 10px/1 var(--font-display);
  letter-spacing: 0.04em;
  flex: none;
}

.row-mark.is-create {
  border: 1px dashed var(--hair-strong);
  background: transparent;
  color: var(--ink-3);
}

.row-text {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.menu-name {
  color: var(--ink-1);
  font: 500 12.5px/1.4 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-manager {
  color: var(--ink-3);
  font: 400 11px/1.4 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-check {
  color: var(--accent, var(--ok));
  flex: none;
}

.create-row {
  margin-top: 3px;
  padding-top: 9px;
  border-top: 1px solid var(--hair);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.menu-name.is-create-label {
  color: var(--ink-2);
  font-weight: 500;
}

.create-row:hover .menu-name.is-create-label {
  color: var(--ink-1);
}

.create-row:hover .row-mark.is-create {
  color: var(--ink-1);
  border-color: var(--ink-3);
}
</style>
