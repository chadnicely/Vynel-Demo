<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhPencilSimple as Pencil,
  PhPlus as Plus,
  PhTerminalWindow as SquareSlash,
  PhX as X,
} from "@phosphor-icons/vue";
import { EmptyState, MarkdownText, Modal } from "@vynel/ui";
import { useCommands } from "../../composables/commands/use-commands.js";
import { useDeleteCommand } from "../../composables/commands/use-delete-command.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";
import WriteCommandDialog from "./WriteCommandDialog.vue";

// The slash commands a surface OWNS — the `.claude/commands/*.md` files in
// that folder on disk (subfolders namespace: git/commit.md → /git:commit).
// The file is the record: writing, editing and deleting here are whole-file
// operations on that folder. The composer's "/" menu asks the other question
// — everything runnable there — and reads the resolved union, so a global
// command still works in a room without appearing in its shelf.
const props = defineProps<{
  scope: SectionScope;
}>();

const commandsQuery = useCommands(() => props.scope);
const commands = computed(() => commandsQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();
const deleteCommand = useDeleteCommand();

function scopeChip(rowScope: "user" | "workspace"): string {
  if (rowScope === "user") return "Global";
  return props.scope.kind === "workspace"
    ? scopeLabel(props.scope.workspaceId)
    : "Workspace";
}

// The prompt (`body`) is what the row reads and edits; the frontmatter
// block is the engine's to parse and render, so the dialogs never see it.
type CommandRow = {
  commandName: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
  scope: "user" | "workspace";
};

const viewingCommand = ref<{ commandName: string; body: string } | null>(null);
const isWriteOpen = ref(false);
const editingCommand = ref<{
  commandName: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
} | null>(null);

function startWriting() {
  editingCommand.value = null;
  isWriteOpen.value = true;
}

function startEditing(command: CommandRow) {
  editingCommand.value = {
    commandName: command.commandName,
    description: command.description,
    argumentHint: command.argumentHint,
    body: command.body,
  };
  isWriteOpen.value = true;
}

function onSaved() {
  isWriteOpen.value = false;
  editingCommand.value = null;
}

// A command file is gone for good once deleted — so, per the notebook's
// idiom, the X arms first ("Sure?"), only a second explicit click fires the
// delete, and losing focus disarms.
const armedDeleteName = ref<string | null>(null);

function requestDelete(command: CommandRow) {
  if (armedDeleteName.value !== command.commandName) {
    armedDeleteName.value = command.commandName;
    return;
  }
  armedDeleteName.value = null;
  deleteCommand.mutate({
    commandName: command.commandName,
    scope:
      command.scope === "workspace" && props.scope.kind === "workspace"
        ? { scope: "workspace", workspaceId: props.scope.workspaceId }
        : { scope: "user" },
  });
}

function disarmDelete(commandName: string) {
  if (armedDeleteName.value === commandName) armedDeleteName.value = null;
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Reusable prompts Claude runs by name, in every workspace"
    : "Slash commands kept in this workspace",
);
</script>

<template>
  <div class="commands-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SquareSlash"
      title="Commands"
      :subtitle="sectionHint"
    >
      <template v-if="commands.length > 0" #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a command
        </button>
      </template>
    </SectionHeader>

    <div v-if="commands.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="command in commands"
        :key="`${command.scope}:${command.commandName}`"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <button
          type="button"
          class="row-open flex min-w-0 flex-1 cursor-default items-center gap-3 border-0 bg-transparent p-0 text-left"
          @click="
            viewingCommand = {
              commandName: command.commandName,
              body: command.body,
            }
          "
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
                }}<span
                  v-if="command.argumentHint"
                  class="ml-1.5 font-normal text-ink-3"
                  >{{ command.argumentHint }}</span
                >
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
        </button>
        <button
          type="button"
          class="icon-button edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Edit /${command.commandName}`"
          :aria-label="`Edit /${command.commandName}`"
          @click="startEditing(command)"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedDeleteName === command.commandName
              ? 'row-action delete-button is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button delete-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :title="
            armedDeleteName === command.commandName
              ? `Confirm delete /${command.commandName}`
              : `Delete /${command.commandName}`
          "
          :aria-label="
            armedDeleteName === command.commandName
              ? `Confirm delete /${command.commandName}`
              : `Delete /${command.commandName}`
          "
          @click="requestDelete(command)"
          @blur="disarmDelete(command.commandName)"
        >
          <template v-if="armedDeleteName === command.commandName"
            >Sure?</template
          >
          <X v-else :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No commands yet"
      hint="Commands are reusable prompts you trigger with a slash — write one here and run it as /its-name."
    >
      <template #icon>
        <SquareSlash :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a command
        </button>
      </template>
    </EmptyState>

    <!-- Read-only view — the same sanitized renderer chat uses. -->
    <Modal
      :open="viewingCommand !== null"
      size="lg"
      description="Read-only view of this command's prompt."
      @update:open="(open: boolean) => !open && (viewingCommand = null)"
    >
      <template #title>/{{ viewingCommand?.commandName }}</template>
      <div
        v-if="viewingCommand !== null"
        class="command-body rounded-sm border border-hair bg-panel p-3 text-sm leading-[1.65] text-ink-1 break-words"
      >
        <MarkdownText :source="viewingCommand.body" />
      </div>
    </Modal>

    <WriteCommandDialog
      :open="isWriteOpen"
      :default-scope="props.scope"
      :editing="editingCommand"
      @close="onSaved"
      @saved="onSaved"
    />
  </div>
</template>
