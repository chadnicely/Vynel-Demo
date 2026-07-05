<script setup lang="ts">
import { ChatComposer } from "@vynel/ui";
import { SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import { demoModels } from "../../demo/fixtures/models.js";
import { useUiStore } from "../../stores/ui-store.js";

// The app-bound composer: binds the shared ChatComposer to Vynel state —
// demo model list (provider-preferences API later), the REAL session-mode
// vocabulary, the voice overlay, and the shared composer selections.
const props = defineProps<{
  streaming?: boolean | undefined;
  placeholder?: string | undefined;
}>();

const emit = defineEmits<{
  send: [text: string];
  interrupt: [];
}>();

const ui = useUiStore();

const modeOptions = SESSION_MODES.map((mode) => ({
  id: mode.mode,
  label: mode.label,
}));

function onSend(text: string, attachments: File[]) {
  // Demo-phase: attachments are accepted by the UI but not yet carried into
  // the turn (the real turn input's attachedImages wires up with the API).
  void attachments;
  emit("send", text);
}
</script>

<template>
  <ChatComposer
    :placeholder="props.placeholder"
    :streaming="props.streaming"
    :models="demoModels"
    :model-id="ui.composerModelId"
    :modes="modeOptions"
    :mode-id="ui.composerMode"
    show-voice
    @update:model-id="(id) => (ui.composerModelId = id)"
    @update:mode-id="(id) => (ui.composerMode = id as SessionMode)"
    @send="onSend"
    @interrupt="emit('interrupt')"
    @voice="ui.isVoiceOverlayOpen = true"
  />
</template>
