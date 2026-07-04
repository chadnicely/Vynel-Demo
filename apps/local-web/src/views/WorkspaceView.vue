<script setup lang="ts">
import { FolderOpen } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
</script>

<template>
  <div class="workspace-view">
    <EmptyState
      title="No workspace selected"
      hint="Workspaces are the project rooms your assistant works in — each with its own chat, files, and tools."
    >
      <template #icon>
        <FolderOpen :size="22" />
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.workspace-view {
  height: 100%;
  display: grid;
  place-items: center;
  overflow-y: auto;
}
</style>
