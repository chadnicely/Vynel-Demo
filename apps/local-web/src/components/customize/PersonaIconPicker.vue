<script setup lang="ts">
import { computed, ref } from "vue";
import { ClaudeMark } from "@vynel/ui";
import { useCustomizeStore } from "../../stores/customize-store.js";
import { imageFileToAvatarDataUrl } from "../../utils/image-to-avatar.js";

// The persona's conversation icon: the Claude mark by default, or an image
// the user picks. The avatar is stored per scope in the customize store and
// shows beside assistant replies in the thread.
const props = defineProps<{
  scopeKey: string;
}>();

const store = useCustomizeStore();
const fileInput = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);

const personaImage = computed(
  () => store.customizationFor(props.scopeKey).personaImage,
);

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  uploadError.value = null;
  try {
    store.setPersonaImage(props.scopeKey, await imageFileToAvatarDataUrl(file));
  } catch (error) {
    uploadError.value =
      error instanceof Error ? error.message : "Could not read that image.";
  }
}
</script>

<template>
  <div class="persona-icon-picker flex flex-col gap-1">
    <p class="m-0 text-xs text-ink-2">Conversation icon</p>
    <div class="flex items-center gap-2.5">
      <span
        class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-hair bg-raised"
      >
        <img
          v-if="personaImage !== null"
          :src="personaImage"
          alt="Persona icon"
          class="size-full object-cover"
        />
        <ClaudeMark v-else :size="18" />
      </span>
      <button
        type="button"
        class="inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        @click="fileInput?.click()"
      >
        {{ personaImage === null ? "Upload image" : "Change image" }}
      </button>
      <button
        v-if="personaImage !== null"
        type="button"
        class="inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        @click="store.setPersonaImage(props.scopeKey, null)"
      >
        Use Claude icon
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        aria-label="Upload persona icon"
        @change="onFilePicked"
      />
    </div>
    <p v-if="uploadError" class="m-0 text-2xs text-danger">
      {{ uploadError }}
    </p>
  </div>
</template>
