<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhFolderOpen, PhGitBranch } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import FileSystemBrowser from "../filesystem/FileSystemBrowser.vue";
import type { FileSystemSelection } from "../filesystem/file-system-selection.js";
import { useCloneRepositoryWorkspace } from "../../composables/workspaces/use-clone-repository-workspace.js";
import { useTooBroadFolder } from "../../composables/workspaces/use-too-broad-folder.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// "Create from a repository" (Chad, 2026-08-11) — the second door under
// "bring in what you have". One screen: the repository address, a name (which
// is also the folder), and the folder it is cloned inside — the user's own
// pick, never a fixed home. Clone it runs the clone and registers the result;
// the dialog stays up with git's own reason if it fails.
const props = defineProps<{
  open: boolean;
  /** The menu-tree group the door was opened from; null = the tree root. */
  groupId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  back: [];
  created: [workspace: WorkspaceResponse];
}>();

const clone = useCloneRepositoryWorkspace();

const repositoryUrl = ref("");
const name = ref("");
const nameEdited = ref(false);
const selection = ref<FileSystemSelection | null>(null);

const isOpen = computed(() => props.open);
const { isTooBroad, reason: tooBroadReason } = useTooBroadFolder(
  selection,
  isOpen,
);

// The name follows the repository's own name until the user types their own —
// https://github.com/acme/pricing-tool.git → "pricing-tool".
watch(repositoryUrl, (next) => {
  if (!nameEdited.value) name.value = repositoryBaseName(next);
});

function repositoryBaseName(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  return trimmed.slice(
    Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":")) + 1,
  );
}

function onNameInput(event: Event) {
  nameEdited.value = (event.target as HTMLInputElement).value.trim().length > 0;
  if (!nameEdited.value) name.value = repositoryBaseName(repositoryUrl.value);
}

// Clear the fields whenever the dialog reopens, so a second workspace never
// inherits the first one's answers.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    repositoryUrl.value = "";
    name.value = "";
    nameEdited.value = false;
    selection.value = null;
    clone.reset();
  },
);

const parentPath = computed(() =>
  selection.value !== null && !isTooBroad.value ? selection.value.path : null,
);
const separator = computed(() =>
  parentPath.value?.includes("\\") ? "\\" : "/",
);
const folderShown = computed(() => name.value.trim() || "project");

const gate = computed(() => {
  if (repositoryUrl.value.trim().length === 0)
    return "Paste a repository address to continue";
  if (parentPath.value === null)
    return "Pick the folder it will live in to continue";
  if (name.value.trim().length === 0) return "Name the workspace to continue";
  return null;
});

const errorMessage = computed(() =>
  clone.error.value ? formatSdkError(clone.error.value) : null,
);

function submit() {
  const parent = parentPath.value;
  if (gate.value !== null || clone.isPending.value || parent === null) return;
  clone.mutate(
    {
      name: name.value.trim(),
      parentPath: parent,
      repositoryUrl: repositoryUrl.value.trim(),
      ...(props.groupId !== null ? { groupId: props.groupId } : {}),
    },
    {
      onSuccess: (made) => emit("created", made.workspace as WorkspaceResponse),
    },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Create from a repository"
    description="Paste the repository address, pick where it should live, and name it. We clone it into a new folder — nothing you already have is touched."
    size="xl"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >Repository address</span
        >
        <input
          v-model="repositoryUrl"
          type="text"
          autofocus
          spellcheck="false"
          placeholder="https://github.com/you/project.git"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="submit"
        />
        <span class="flex items-center gap-1.5 text-[11px] text-ink-3">
          <PhGitBranch :size="13" />
          An https or ssh git address. We clone exactly what is there — your
          history comes with it.
        </span>
      </label>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2"
          >Where will it live?</span
        >
        <FileSystemBrowser
          v-model="selection"
          mode="folder"
          :active="props.open"
        />
        <span v-if="tooBroadReason" class="text-[11px] text-needs-input">
          That's your whole {{ tooBroadReason }} — open it and pick the folder
          this should be cloned inside.
        </span>
        <span v-else class="text-[11px] text-ink-3">
          Click a folder to choose it, double-click to open it. The clone lands
          in a new folder inside the one you choose.
        </span>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          placeholder="Picked from the address — change it if you like"
          class="name w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @input="onNameInput"
          @keydown.enter.prevent="submit"
        />
      </label>
      <p
        v-if="parentPath"
        class="m-0 flex items-center gap-1.5 text-[12px] text-ink-2"
      >
        <PhFolderOpen :size="13" />
        It will live at
        <code
          class="rounded-sm bg-panel px-1.5 py-0.5 text-[11.5px] text-ink-1"
        >
          {{ parentPath }}{{ separator }}{{ folderShown }}
        </code>
      </p>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('back')"
      >
        ← Back
      </button>
      <span class="flex-1 text-[12px] text-ink-3">{{ gate ?? "" }}</span>
      <button
        type="button"
        class="clone cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="gate !== null || clone.isPending.value"
        @click="submit"
      >
        {{ clone.isPending.value ? "Cloning…" : "Clone it" }}
      </button>
    </template>
  </Modal>
</template>
