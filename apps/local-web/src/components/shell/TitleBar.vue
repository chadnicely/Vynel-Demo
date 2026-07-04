<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Menu, Mic, Moon, PanelLeft, Plus, Sun } from "lucide-vue-next";
import { IconButton, PresenceDot, SegmentedTabs } from "@vynel/ui";
import { useUiStore } from "../../stores/ui-store.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { usePendingApprovals } from "../../composables/approvals/use-pending-approvals.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import WorkspaceSwitcher from "../workspace/WorkspaceSwitcher.vue";

const TABS = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "workspace", label: "Workspace" },
];

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const activity = useActivityStore();
const pendingApprovalsQuery = usePendingApprovals();
const workspacesQuery = useWorkspaceList();

const activeTab = computed(() =>
  typeof route.name === "string" ? route.name : "home",
);
const isChatSurface = computed(
  () => activeTab.value === "chat" || activeTab.value === "workspace",
);
const isWorkspaceTab = computed(() => activeTab.value === "workspace");

// The status light: gold ring = needs you, gold pulse = working.
const pendingCount = computed(
  () => pendingApprovalsQuery.data.value?.length ?? 0,
);
const presenceState = computed(() => {
  if (pendingCount.value > 0) return "attention" as const;
  if (activity.isTurnRunning) return "live" as const;
  return "idle" as const;
});
const presenceLabel = computed(() => {
  if (pendingCount.value > 0)
    return `${pendingCount.value} approval${pendingCount.value === 1 ? "" : "s"} waiting`;
  if (activity.isTurnRunning) return "assistant working";
  return "assistant idle";
});

function goToTab(tabId: string) {
  void router.push({ name: tabId });
}

function startFreshConversation() {
  ui.workspaceChat.target = "fresh";
  ui.workspaceChat.mainView = "chat";
}
</script>

<template>
  <header class="title-bar" data-tauri-drag-region>
    <div class="left-cluster">
      <template v-if="isChatSurface">
        <IconButton
          label="Menu"
          :active="ui.isMenuOpen"
          @click="ui.isMenuOpen = !ui.isMenuOpen"
        >
          <Menu :size="15" />
        </IconButton>
        <IconButton
          label="Toggle conversation history"
          :active="ui.isSessionListOpen"
          @click="ui.isSessionListOpen = !ui.isSessionListOpen"
        >
          <PanelLeft :size="15" />
        </IconButton>
      </template>

      <template v-if="isWorkspaceTab">
        <WorkspaceSwitcher
          class="switcher"
          :workspaces="workspacesQuery.data.value?.workspaces ?? []"
          :active-workspace-id="ui.activeWorkspaceId"
          @select="(id) => (ui.activeWorkspaceId = id)"
        />
        <IconButton label="New conversation" @click="startFreshConversation()">
          <Plus :size="15" />
        </IconButton>
      </template>
    </div>

    <nav class="tabs">
      <SegmentedTabs
        :tabs="TABS"
        :model-value="activeTab"
        @update:model-value="goToTab"
      />
    </nav>

    <div class="controls">
      <PresenceDot
        :state="presenceState"
        :label="presenceLabel"
        class="presence"
      />
      <IconButton
        label="Open voice"
        :active="ui.isVoiceOverlayOpen"
        @click="ui.isVoiceOverlayOpen = !ui.isVoiceOverlayOpen"
      >
        <Mic :size="15" />
      </IconButton>
      <IconButton
        :label="
          ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
        "
        @click="ui.toggleTheme()"
      >
        <Sun v-if="ui.theme === 'dark'" :size="15" />
        <Moon v-else :size="15" />
      </IconButton>
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 40px;
  padding: 0 10px;
  background: var(--bg-shell);
  border-bottom: 1px solid var(--hair);
  user-select: none;
  -webkit-user-select: none;
}

.left-cluster {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-self: start;
  min-width: 0;
}

.switcher {
  max-width: 220px;
}

.tabs {
  justify-self: center;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-self: end;
}

.presence {
  margin-right: 2px;
}
</style>
