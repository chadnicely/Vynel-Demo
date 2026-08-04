<script setup lang="ts">
// The Claude-desktop-style Background overview (persona-sessions B7) — the
// monitor panel's BASE node: every persona working or holding queued tasks,
// one group each. Clicking the persona opens their conversation (the B6
// pane); clicking a task row watches its trace; the square stops it. Rendered
// from the shared data spine — this view owns no channel and no polling.
import { computed, onScopeDispose, ref } from "vue";
import { EmptyState, PresenceDot, formatElapsed } from "@vynel/ui";
import { Activity } from "lucide-vue-next";
import type { BackgroundGroupView } from "../../composables/activity/use-background-activity.js";
import { ORIGIN_NOTES } from "../home/origin-notes.js";

const props = defineProps<{ groups: BackgroundGroupView[] }>();

const emit = defineEmits<{
  openSession: [sessionId: string, title: string];
  openTrace: [partialSessionId: string];
  stop: [partialSessionId: string];
}>();

const nowMs = ref(Date.now());
const elapsedTimer = setInterval(() => {
  nowMs.value = Date.now();
}, 1000);
onScopeDispose(() => clearInterval(elapsedTimer));

const hasWork = computed(() => props.groups.length > 0);

function elapsedFor(startedAt: string | null): string | null {
  if (startedAt === null) return null;
  return formatElapsed(new Date(startedAt).getTime(), nowMs.value);
}

function stateLine(group: BackgroundGroupView): string {
  const head = group.rows[0];
  if (head === undefined || head.state === "queued")
    return "Queued — starting soon…";
  return group.narration ?? "Working…";
}

function originNote(group: BackgroundGroupView): string | null {
  const origin = group.rows[0]?.origin;
  return origin == null ? null : ORIGIN_NOTES[origin];
}
</script>

<template>
  <div class="grid gap-2.5" data-testid="background-roster">
    <EmptyState
      v-if="!hasWork"
      title="Nothing running"
      hint="When your assistant works in the background — tasks, schedules, channels — it shows up here live."
    >
      <template #icon>
        <Activity :size="22" />
      </template>
    </EmptyState>

    <section
      v-for="group in props.groups"
      :key="group.key"
      class="rounded-[var(--radius-m)] border border-[var(--hair)] bg-[var(--bg-panel)] px-3.5 py-3 grid gap-2"
      data-testid="background-group"
    >
      <!-- The persona header — click opens their conversation when we know it. -->
      <component
        :is="group.sessionId === null ? 'div' : 'button'"
        :type="group.sessionId === null ? undefined : 'button'"
        class="flex items-center gap-2 min-w-0 text-left w-full"
        :class="group.sessionId === null ? '' : 'group cursor-default'"
        data-testid="background-group-head"
        @click="
          group.sessionId !== null &&
            emit('openSession', group.sessionId, group.personaName)
        "
      >
        <img
          v-if="group.persona.imageUrl"
          :src="group.persona.imageUrl"
          alt=""
          class="w-6 h-6 rounded-full object-cover flex-none"
        />
        <span
          v-else
          class="w-6 h-6 rounded-full flex-none grid place-items-center text-[10px] font-semibold text-[var(--ink-1)]"
          :style="{
            background: `color-mix(in srgb, var(${group.persona.accentVar}) 30%, transparent)`,
          }"
          >{{ group.persona.monogram }}</span
        >
        <span class="min-w-0 grid">
          <span
            class="text-[12.5px] font-semibold text-[var(--ink-1)] truncate group-hover:underline"
            >{{ group.personaName }}</span
          >
          <span
            v-if="group.workspaceName"
            class="text-[10.5px] text-[var(--ink-3)] truncate"
            >{{ group.workspaceName }}</span
          >
        </span>
        <PresenceDot
          :state="group.rows[0]?.state === 'working' ? 'live' : 'idle'"
          class="flex-none"
        />
        <span
          v-if="originNote(group)"
          class="flex-none text-[10.5px] text-[var(--ink-3)]"
          >{{ originNote(group) }}</span
        >
        <span
          v-if="elapsedFor(group.rows[0]?.startedAt ?? null)"
          class="ml-auto flex-none text-[10.5px] text-[var(--ink-3)] tabular-nums"
          >{{ elapsedFor(group.rows[0]?.startedAt ?? null) }}</span
        >
      </component>

      <p class="m-0 text-[12px] text-[var(--ink-2)] truncate">
        {{ stateLine(group) }}
      </p>

      <!-- One row per task — Watch drills into its trace, the square stops. -->
      <ul class="m-0 p-0 list-none grid gap-1">
        <li
          v-for="row in group.rows"
          :key="row.key"
          class="flex items-center gap-2 min-w-0"
          data-testid="background-task-row"
        >
          <span
            class="flex-none text-[9.5px] uppercase tracking-[0.07em]"
            :class="
              row.state === 'working'
                ? 'text-[var(--gold)]'
                : 'text-[var(--ink-3)]'
            "
            >{{ row.state === "working" ? "Working" : "Queued" }}</span
          >
          <span class="min-w-0 flex-1 text-[11.5px] text-[var(--ink-2)] truncate">
            {{ row.taskLabel ?? "Conversation turn" }}
          </span>
          <button
            v-if="row.partialSessionId !== null"
            type="button"
            class="flex-none text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)] hover:text-[var(--ink-1)]"
            data-testid="background-task-watch"
            @click="emit('openTrace', row.partialSessionId)"
          >
            Watch
          </button>
          <button
            v-if="row.partialSessionId !== null"
            type="button"
            class="flex-none grid place-items-center w-[16px] h-[16px] rounded-full text-[var(--ink-3)] hover:text-[var(--danger)]"
            :aria-label="`Stop: ${row.taskLabel ?? 'this task'}`"
            data-testid="background-task-stop"
            @click="emit('stop', row.partialSessionId)"
          >
            <svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
