<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  ChevronRight,
  ExternalLink,
  Pencil,
  Play,
  Square,
  SquareTerminal,
  X,
} from "lucide-vue-next";
import type { WorkspaceAppResponse } from "@vynel/contracts/apps/app-http";
import { useAppLogs } from "../../composables/workspace-apps/use-app-logs.js";
import { useRemoveApp } from "../../composables/workspace-apps/use-remove-app.js";
import { useStartApp } from "../../composables/workspace-apps/use-start-app.js";
import { useStopApp } from "../../composables/workspace-apps/use-stop-app.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// One app card (ChannelsSection row idiom): the dot tells the live truth,
// Start/Stop is the primary affordance, edit/remove reveal on hover, and the
// Logs disclosure unfolds the recent output right under the row.
const props = defineProps<{
  app: WorkspaceAppResponse;
  workspaceId: string;
}>();

const emit = defineEmits<{
  edit: [];
}>();

const isRunning = computed(() => props.app.runtime?.status === "running");
const isCrashed = computed(() => props.app.runtime?.status === "crashed");

const crashNote = computed(() => {
  if (!isCrashed.value) return null;
  const exitCode = props.app.runtime?.exitCode;
  return exitCode === null || exitCode === undefined
    ? "stopped unexpectedly"
    : `stopped unexpectedly (code ${exitCode})`;
});

const commandNote = computed(() =>
  props.app.cwdRelative.length > 0
    ? `${props.app.command} · ${props.app.cwdRelative}`
    : props.app.command,
);

const startApp = useStartApp();
const stopApp = useStopApp();
const removeApp = useRemoveApp();

function toggleRun() {
  const target = { workspaceId: props.workspaceId, appId: props.app.id };
  if (isRunning.value) stopApp.mutate(target);
  else startApp.mutate(target);
}

function remove() {
  removeApp.mutate({ workspaceId: props.workspaceId, appId: props.app.id });
}

// A failed start (409 "already running") or stop reads as one plain line
// under the row; the settle-time list refresh re-syncs the dot on its own.
const actionError = computed(() => {
  const error =
    startApp.error.value ?? stopApp.error.value ?? removeApp.error.value;
  return error ? formatSdkError(error) : null;
});

const isLogsOpen = ref(false);
const logsQuery = useAppLogs(
  () => props.workspaceId,
  () => props.app.id,
  () => isLogsOpen.value,
);
const logLines = computed(() => logsQuery.data.value?.lines ?? []);

// Follow the tail: each poll that brings new lines pins the view to the bottom.
const logViewport = ref<HTMLElement | null>(null);
watch(logLines, async () => {
  await nextTick();
  const viewport = logViewport.value;
  if (viewport) viewport.scrollTop = viewport.scrollHeight;
});
</script>

<template>
  <div
    class="row group flex flex-col rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
  >
    <div class="flex items-center gap-3">
      <span
        class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
      >
        <SquareTerminal :size="17" />
      </span>
      <div class="row-main min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span
            class="status-dot size-2 shrink-0 rounded-full"
            :class="
              isRunning
                ? 'is-running bg-ok'
                : isCrashed
                  ? 'is-crashed bg-danger'
                  : 'is-stopped bg-ink-3'
            "
            :title="isRunning ? 'Running' : isCrashed ? 'Crashed' : 'Not running'"
          />
          <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
            {{ props.app.name }}
          </p>
          <a
            v-if="isRunning && props.app.port !== null"
            :href="`http://localhost:${props.app.port}`"
            target="_blank"
            rel="noreferrer"
            class="browser-link inline-flex shrink-0 items-center gap-1 text-xs font-medium text-info hover:underline"
          >
            Open in browser
            <ExternalLink :size="11" />
          </a>
        </div>
        <p class="row-sub m-0 mt-0.5 truncate font-mono text-xs text-ink-3">
          {{ commandNote }}
        </p>
        <p v-if="crashNote" class="crash-note m-0 mt-0.5 text-xs text-danger">
          {{ crashNote }}
        </p>
      </div>
      <button
        type="button"
        class="edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
        :title="`Edit ${props.app.name}`"
        :aria-label="`Edit ${props.app.name}`"
        @click="emit('edit')"
      >
        <Pencil :size="14" />
      </button>
      <button
        type="button"
        class="remove-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        :title="`Remove ${props.app.name}`"
        :aria-label="`Remove ${props.app.name}`"
        @click="remove"
      >
        <X :size="14" />
      </button>
      <button
        type="button"
        class="run-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 text-[11px] font-semibold transition hover:border-hair-strong"
        :class="isRunning ? 'bg-danger/10 text-danger' : 'bg-ok/15 text-ok'"
        :title="isRunning ? `Stop ${props.app.name}` : `Start ${props.app.name}`"
        :aria-label="
          isRunning ? `Stop ${props.app.name}` : `Start ${props.app.name}`
        "
        @click="toggleRun"
      >
        <Square v-if="isRunning" :size="10" />
        <Play v-else :size="10" />
        {{ isRunning ? "Stop" : "Start" }}
      </button>
    </div>

    <p v-if="actionError" class="m-0 mt-2 text-xs text-danger" role="alert">
      {{ actionError }}
    </p>

    <button
      type="button"
      class="logs-toggle mt-2 inline-flex cursor-default items-center gap-1 self-start rounded-md px-1 py-0.5 text-xs font-semibold text-ink-3 transition hover:text-ink-1"
      :aria-expanded="isLogsOpen"
      :aria-label="`Logs for ${props.app.name}`"
      @click="isLogsOpen = !isLogsOpen"
    >
      <ChevronRight
        :size="13"
        class="transition-transform"
        :class="{ 'rotate-90': isLogsOpen }"
      />
      Logs
    </button>
    <div
      v-if="isLogsOpen"
      ref="logViewport"
      class="log-view mt-1.5 max-h-48 overflow-y-auto rounded-md bg-shell p-2.5 font-mono text-xs text-ink-2"
    >
      <p
        v-for="(line, index) in logLines"
        :key="index"
        class="m-0 whitespace-pre-wrap break-all"
      >
        {{ line }}
      </p>
      <p v-if="logLines.length === 0" class="m-0 text-ink-3">
        Nothing printed yet.
      </p>
    </div>
  </div>
</template>
