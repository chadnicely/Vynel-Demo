<script setup lang="ts">
import { computed } from "vue";
import { SquareSlash } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useCommands } from "../../composables/commands/use-commands.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The slash commands on either surface — every `.claude/commands/*.md` file
// Claude Code resolves there (subfolders namespace: git/commit.md →
// /git:commit). Read-only: the files are the user's own; Task 3's "/" menu
// will offer the same rows in the composer.
const props = defineProps<{
  scope: SectionScope;
}>();

const commandsQuery = useCommands(() => props.scope);
const commands = computed(() => commandsQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();

function scopeChip(rowScope: "user" | "workspace"): string {
  if (rowScope === "user") return "Global";
  return props.scope.kind === "workspace"
    ? scopeLabel(props.scope.workspaceId)
    : "Workspace";
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Reusable prompts Claude runs by name, in every workspace"
    : "Reusable slash commands it can run",
);
</script>

<template>
  <div class="commands-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SquareSlash"
      title="Commands"
      :subtitle="sectionHint"
    />

    <div v-if="commands.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="command in commands"
        :key="`${command.scope}:${command.commandName}`"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ws-1/12 text-ws-1"
        >
          <SquareSlash :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p
              class="row-title m-0 truncate font-mono text-[13px] font-semibold text-ink-1"
            >
              /{{ command.commandName
              }}<span v-if="command.argumentHint" class="ml-1.5 font-normal text-ink-3">{{
                command.argumentHint
              }}</span>
            </p>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeChip(command.scope) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ command.description ?? command.bodyPreview ?? "" }}
          </p>
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      title="No commands yet"
      hint="Commands are reusable prompts you trigger with a slash — drop a Markdown file into the .claude/commands folder and it shows up here."
    >
      <template #icon>
        <SquareSlash :size="22" />
      </template>
    </EmptyState>
  </div>
</template>
