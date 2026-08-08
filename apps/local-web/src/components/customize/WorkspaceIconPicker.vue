<script setup lang="ts">
import { computed, ref } from "vue";
import { workspaceMonogram } from "@vynel/ui";
import { useCustomizeStore } from "../../stores/customize-store.js";
import { imageFileToAvatarDataUrl } from "../../utils/image-to-avatar.js";

// The WORKSPACE's own icon (Chad, 2026-08-09): shows on author-line chips and
// hover profile cards wherever a message names its workspace. Default = the
// name-derived monogram over the accent; an uploaded image replaces it.
const props = defineProps<{
  workspaceId: string;
  workspaceName: string;
}>();

const store = useCustomizeStore();
const fileInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);

const workspaceImage = computed(
  () => store.customizationFor(props.workspaceId).workspaceImage,
);

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  uploadError.value = null;
  try {
    store.setWorkspaceImage(
      props.workspaceId,
      await imageFileToAvatarDataUrl(file),
    );
  } catch (error) {
    uploadError.value =
      error instanceof Error ? error.message : "Could not read that image.";
  }
}
</script>

<template>
  <div class="workspace-icon-picker flex flex-col gap-1">
    <p class="m-0 text-xs text-ink-2">Workspace icon</p>
    <div class="flex items-center gap-2.5">
      <span
        class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-hair bg-raised text-xs font-semibold text-ink-1"
      >
        <img
          v-if="workspaceImage !== null"
          :src="workspaceImage"
          alt="Workspace icon"
          class="size-full object-cover"
        />
        <span v-else>{{ workspaceMonogram(props.workspaceName) }}</span>
      </span>
      <button
        type="button"
        class="inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        @click="fileInput?.click()"
      >
        {{ workspaceImage === null ? "Upload image" : "Change image" }}
      </button>
      <button
        v-if="workspaceImage !== null"
        type="button"
        class="inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        @click="store.setWorkspaceImage(props.workspaceId, null)"
      >
        Use monogram
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        aria-label="Upload workspace icon"
        @change="onFilePicked"
      />
    </div>
    <p v-if="uploadError" class="m-0 text-2xs text-danger">
      {{ uploadError }}
    </p>
  </div>
</template>
