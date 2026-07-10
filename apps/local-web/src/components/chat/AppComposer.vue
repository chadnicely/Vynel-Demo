<script setup lang="ts">
import { computed, ref } from "vue";
import { ChatComposer } from "@vynel/ui";
import { SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import { CHAT_MODELS } from "@vynel/contracts/chat/chat-models";
import { useUiStore } from "../../stores/ui-store.js";
import { useDictation } from "../../composables/voice/use-dictation.js";
import { filesToTurnAttachments } from "../../composables/chat/turn-attachments.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";

// The app-bound composer: binds the shared ChatComposer to Vynel state — the
// real curated model allowlist + session-mode vocabulary, and the shared
// composer selections. The composer mic DICTATES (speech types into the
// draft); talking with the assistant is the top-bar mic → voice overlay.
// Picked/pasted files are encoded + validated here, so the views receive
// wire-ready attachments.
const props = defineProps<{
  streaming?: boolean | undefined;
  placeholder?: string | undefined;
}>();

const emit = defineEmits<{
  send: [text: string, attachments: TurnAttachmentInput[]];
  interrupt: [];
}>();

const ui = useUiStore();

const draft = ref("");
const dictation = useDictation(draft);
const attachmentNotice = ref<string | null>(null);

// The composer prop is mutable; the contract list is readonly — copy once.
const modelOptions = [...CHAT_MODELS];

const modeOptions = SESSION_MODES.map((mode) => ({
  id: mode.mode,
  label: mode.label,
}));

const notice = computed(
  () => attachmentNotice.value ?? dictation.error.value ?? undefined,
);

async function onSend(text: string, files: File[]) {
  // A send mid-dictation must not resurrect late words into the cleared box.
  dictation.cancel();
  let attachments;
  try {
    const converted = await filesToTurnAttachments(files);
    attachments = converted.attachments;
    attachmentNotice.value =
      converted.rejectedNames.length > 0
        ? `Couldn't attach ${converted.rejectedNames.join(", ")} — unsupported type, larger than 5 MB, or past the 6-file limit.`
        : null;
  } catch (readError) {
    // A failed disk read must be SAID, not swallowed into the void hook.
    attachmentNotice.value =
      readError instanceof Error
        ? readError.message
        : "One of the files couldn't be read — try attaching it again.";
    return;
  }
  // Everything the person tried to send was rejected — keep the notice, send nothing.
  if (text.trim().length === 0 && attachments.length === 0) return;
  emit("send", text, attachments);
}
</script>

<template>
  <ChatComposer
    v-model:draft="draft"
    :placeholder="props.placeholder"
    :streaming="props.streaming"
    :models="modelOptions"
    :model-id="ui.composerModelId"
    :modes="modeOptions"
    :mode-id="ui.composerMode"
    show-voice
    :voice-active="dictation.isDictating.value"
    :notice="notice"
    @update:model-id="(id) => (ui.composerModelId = id)"
    @update:mode-id="(id) => (ui.composerMode = id as SessionMode)"
    @send="onSend"
    @interrupt="emit('interrupt')"
    @voice="dictation.toggle"
  />
</template>
