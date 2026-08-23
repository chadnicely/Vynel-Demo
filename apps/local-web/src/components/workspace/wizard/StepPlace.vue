<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhFolderOpen } from "@phosphor-icons/vue";
import FileSystemBrowser from "../../filesystem/FileSystemBrowser.vue";
import { basenameOfPath } from "../../filesystem/file-system-path.js";
import type { FileSystemSelection } from "../../filesystem/file-system-selection.js";
import { useTooBroadFolder } from "../../../composables/workspaces/use-too-broad-folder.js";
import { useWizardAnswers } from "./wizard-answers.js";
import { FIELD_LABEL, HINT, INPUT } from "./wizard-classes.js";

// Screen 1 — a home and a name. The folder the user picks IS the workspace
// (Kafi, 2026-08-23: never a child folder minted from the name — the
// browser's New folder makes an empty one when they want one), chosen in the
// same Explorer-style browser every picker shares, never the global space.
// The name follows the folder until the user types their own — the same
// posture as "Pull from a folder".
const props = defineProps<{ active: boolean }>();

const answers = useWizardAnswers();

// Re-mounted with a pick already made (Back to this screen): the selection
// carries the folder's real name, so "is the name still following the
// folder?" below answers truthfully.
const selection = ref<FileSystemSelection | null>(
  answers.directory === null
    ? null
    : {
        kind: "folder",
        path: answers.directory,
        name: basenameOfPath(answers.directory),
      },
);

const isActive = computed(() => props.active);
const { isTooBroad, reason } = useTooBroadFolder(selection, isActive);

watch([selection, isTooBroad], ([picked, tooBroad]) => {
  answers.directory = picked !== null && !tooBroad ? picked.path : null;
});

// Once the user types a name it stops following the folder; clearing it hands
// control back to the folder. Survives a re-mount of this step: a name equal
// to the folder's is still "following".
const nameEdited = ref(
  answers.appName !== "" && answers.appName !== (selection.value?.name ?? ""),
);
const suggestedName = computed(() =>
  selection.value !== null && !isTooBroad.value ? selection.value.name : "",
);
watch(suggestedName, (suggested) => {
  if (!nameEdited.value && suggested !== "") answers.appName = suggested;
});

function onNameInput(event: Event) {
  const typed = (event.target as HTMLInputElement).value;
  nameEdited.value = typed.trim().length > 0;
  if (!nameEdited.value) answers.appName = suggestedName.value;
}
</script>

<template>
  <div class="grid gap-1.5">
    <span :class="FIELD_LABEL">Where will it live?</span>
    <FileSystemBrowser v-model="selection" mode="folder" :active="active" />
    <span v-if="reason" class="text-[11px] text-needs-input">
      That's your whole {{ reason }} — open it and pick the folder this should
      be made in.
    </span>
    <span v-else :class="HINT">
      Click a folder to choose it, double-click to open it. The folder you
      choose is the workspace — New folder makes an empty one. Nothing of yours
      gets moved.
    </span>
  </div>

  <label class="grid gap-1.5">
    <span :class="FIELD_LABEL">What are we calling it?</span>
    <input
      v-model="answers.appName"
      type="text"
      maxlength="120"
      placeholder="Picked from the folder — change it if you like"
      :class="INPUT"
      @input="onNameInput"
    />
  </label>

  <p
    v-if="answers.directory"
    class="m-0 flex items-center gap-1.5 text-[12px] text-ink-2"
  >
    <PhFolderOpen :size="13" />
    It will live at
    <code class="rounded-sm bg-panel px-1.5 py-0.5 text-[11.5px] text-ink-1">
      {{ answers.directory }}
    </code>
  </p>
</template>
