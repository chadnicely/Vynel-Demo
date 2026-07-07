<script setup lang="ts">
import { ref } from "vue";
import type { OptionalChannelStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

const props = defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [input: OptionalChannelStepInput];
}>();

const wantsTelegram = ref(false);
const displayName = ref("My Telegram");
const botToken = ref("");
const allowedSenderId = ref("");

function submit() {
  if (!wantsTelegram.value) {
    emit("submit", { kind: "skipped" });
    return;
  }
  const senderId = allowedSenderId.value.trim();
  emit("submit", {
    kind: "connect",
    channelKind: "telegram",
    displayName: displayName.value.trim(),
    botCredentials: { botToken: botToken.value.trim() },
    ...(senderId.length > 0 ? { initialAllowedSenderId: senderId } : {}),
  });
}
</script>

<template>
  <form @submit.prevent="submit">
    <p class="explain">
      Connect Telegram and you can text your assistant from your phone — same
      brain, same memory, approvals included.
    </p>

    <div class="choice-cards" role="radiogroup" aria-label="Telegram setup">
      <label class="choice" :class="{ 'is-active': !wantsTelegram }">
        <input v-model="wantsTelegram" type="radio" :value="false" />
        <span class="choice-title">Not now</span>
        <span class="choice-body">Desktop only — connect a channel later.</span>
      </label>
      <label class="choice" :class="{ 'is-active': wantsTelegram }">
        <input v-model="wantsTelegram" type="radio" :value="true" />
        <span class="choice-title">Connect Telegram</span>
        <span class="choice-body">Takes two minutes with @BotFather.</span>
      </label>
    </div>

    <div v-if="wantsTelegram" class="telegram-fields">
      <label class="field">
        <span class="field-label">Channel name</span>
        <input v-model="displayName" type="text" required maxlength="120" />
      </label>

      <label class="field">
        <span class="field-label">Bot token</span>
        <input
          v-model="botToken"
          type="password"
          required
          placeholder="123456:ABC-…"
          autocomplete="new-password"
        />
        <span class="field-hint">
          In Telegram, message @BotFather → /newbot → copy the token it gives
          you. The token stays on this computer.
        </span>
      </label>

      <label class="field">
        <span class="field-label">
          Your Telegram user ID
          <span class="optional-tag">optional</span>
        </span>
        <input
          v-model="allowedSenderId"
          type="text"
          placeholder="Only this account may talk to your bot"
        />
      </label>
    </div>

    <StepActions
      :primary-label="wantsTelegram ? 'Connect Telegram' : 'Continue'"
      :busy="props.busy"
      :skippable="wantsTelegram"
      @skip="emit('submit', { kind: 'skipped' })"
    />
  </form>
</template>

<!-- .explain / .choice* / .optional-tag are styled by WizardStepBody (the
     one home for step-shared presentation). -->
<style scoped>
.telegram-fields {
  margin-top: 14px;
  display: grid;
  gap: 12px;
}
</style>
