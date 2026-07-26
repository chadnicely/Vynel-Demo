<script setup lang="ts">
import { computed } from "vue";
import { Inbox } from "lucide-vue-next";
import { MarkdownText, Modal } from "@vynel/ui";
import { useUiStore } from "../../stores/ui-store.js";

// The SHARED report review dialog — the PlanViewDialog pattern: one instance,
// mounted by AppShell, keyed off `ui.viewingReport`. A thread renders a report
// as a COMPACT incoming box (pipeline model, Chad 2026-07-27); this dialog is
// where the FULL report opens. The content rides in with the open call — it
// was already in the thread's DTO, so there is nothing to fetch and no stale
// read to handle.
const ui = useUiStore();

const isOpen = computed(() => ui.viewingReport !== null);

function onOpenChange(open: boolean) {
  if (!open) ui.viewingReport = null;
}
</script>

<template>
  <Modal :open="isOpen" size="lg" @update:open="onOpenChange">
    <template #title>
      <span class="flex items-center gap-2">
        <Inbox :size="18" class="shrink-0 text-ink-3" />
        Report from {{ ui.viewingReport?.sourceLabel ?? "a session" }}
      </span>
    </template>

    <div v-if="ui.viewingReport" class="report-body pb-3 pt-1">
      <MarkdownText :source="ui.viewingReport.body" />
    </div>
  </Modal>
</template>

<style scoped>
/* Long reports scroll inside the dialog, never the page. */
.report-body {
  max-height: 70vh;
  overflow-y: auto;
}
</style>
