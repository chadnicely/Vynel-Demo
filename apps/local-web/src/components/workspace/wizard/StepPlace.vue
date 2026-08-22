<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhFolderOpen } from "@phosphor-icons/vue";
import FileSystemBrowser from "../../filesystem/FileSystemBrowser.vue";
import type { FileSystemSelection } from "../../filesystem/file-system-selection.js";
import { useTooBroadFolder } from "../../../composables/workspaces/use-too-broad-folder.js";
import { useWizardAnswers } from "./wizard-answers.js";
import { FIELD_LABEL, HINT, INPUT } from "./wizard-classes.js";

// Screen 1 — a name and a home. The folder is the user's own, picked in the
// same Explorer-style browser every picker shares (Kafi, 2026-08-23: never
// the global space). The workspace folder is made INSIDE the pick, named
// after the app unless the user takes the folder name over.
const props = defineProps<{ active: boolean }>();

const answers = useWizardAnswers();

const selection = ref<FileSystemSelection | null>(
  answers.parentPath === null
    ? null
    : { kind: "folder", path: answers.parentPath, name: "" },
);

const isActive = computed(() => props.active);
const { isTooBroad, reason } = useTooBroadFolder(selection, isActive);

watch([selection, isTooBroad], ([picked, tooBroad]) => {
  answers.parentPath = picked !== null && !tooBroad ? picked.path : null;
});

// "User-edited" survives a re-mount of this step by comparing against what
// the auto-fill WOULD have produced — a folder that still matches the name
// keeps following it.
const folderEdited = ref(
  answers.folder !== "" && answers.folder !== answers.appName,
);

watch(
  () => answers.appName,
  (next) => {
    if (!folderEdited.value) answers.folder = next;
  },
);

const separator = computed(() =>
  answers.parentPath?.includes("\\") ? "\\" : "/",
);
const folderShown = computed(() => answers.folder.trim() || "New workspace");
</script>

<template>
  <label class="grid gap-1.5">
    <span :class="FIELD_LABEL">What are we calling it?</span>
    <input
      v-model="answers.appName"
      type="text"
      maxlength="120"
      placeholder="Front of House"
      :class="INPUT"
      autofocus
    />
  </label>

  <div class="grid gap-1.5">
    <span :class="FIELD_LABEL">Where will it live?</span>
    <FileSystemBrowser v-model="selection" mode="folder" :active="active" />
    <span v-if="reason" class="text-[11px] text-needs-input">
      That's your whole {{ reason }} — open it and pick the folder this should
      be made inside.
    </span>
    <span v-else :class="HINT">
      Click a folder to choose it, double-click to open it. We make a new folder
      inside the one you choose — nothing of yours gets moved.
    </span>
  </div>

  <label class="grid gap-1.5">
    <span :class="FIELD_LABEL">Folder name</span>
    <input
      v-model="answers.folder"
      type="text"
      maxlength="120"
      placeholder="Front of House"
      spellcheck="false"
      :class="INPUT"
      @input="folderEdited = true"
    />
  </label>
  <p
    v-if="answers.parentPath"
    class="m-0 flex items-center gap-1.5 text-[12px] text-ink-2"
  >
    <PhFolderOpen :size="13" />
    It will live at
    <code class="rounded-sm bg-panel px-1.5 py-0.5 text-[11.5px] text-ink-1">
      {{ answers.parentPath }}{{ separator }}{{ folderShown }}
    </code>
  </p>
</template>
