<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import {
  PhArrowSquareOut as ArrowSquareOut,
  PhArrowsClockwise as ArrowsClockwise,
  PhCircleNotch as CircleNotch,
  PhWarningCircle as WarningCircle,
} from "@phosphor-icons/vue";
import { useClaudeLogin } from "../../composables/providers/use-claude-login.js";

// The sign-in flow, one home for both of the account dialog's doors: the
// signed-out "Sign in with your subscription" and the signed-in "Switch
// account" (an expired auth or a limit-dodging second subscription — Kafi,
// 2026-08-18). The current account stays active until the NEW sign-in lands:
// the CLI only writes its credential file on completion, so cancel and
// failure change nothing.
const props = withDefaults(
  defineProps<{
    idleLabel: string;
    /** `primary` sells the signed-out door; `ghost` keeps the signed-in
     *  switch quiet beside the account card. */
    idleVariant?: "primary" | "ghost";
  }>(),
  { idleVariant: "primary" },
);

const login = useClaudeLogin();
const pastedCode = ref("");

// The dialog closing unmounts this flow — a half-finished sign-in must not
// linger (cancel also discards the server-side relay session).
onBeforeUnmount(() => login.cancel());

function submitCode() {
  void login.submitCode(pastedCode.value);
}
</script>

<template>
  <button
    v-if="login.phase.value === 'idle'"
    type="button"
    class="self-start"
    :class="props.idleVariant === 'ghost' ? 'ghost-button' : 'primary-button'"
    @click="login.begin()"
  >
    <ArrowsClockwise v-if="props.idleVariant === 'ghost'" :size="12" aria-hidden="true" />
    {{ props.idleLabel }}
  </button>

  <p v-else-if="login.phase.value === 'opening'" class="flow-panel flow-note">
    <CircleNotch :size="13" class="spin" aria-hidden="true" />
    Asking Claude for a sign-in link…
  </p>

  <div v-else-if="login.phase.value === 'code'" class="flow-panel">
    <p class="flow-lead">Claude has opened a sign-in page.</p>
    <p class="flow-note">
      Open this link, sign in as the account you want, then paste the code it
      gives you. For a different account than the browser holds, use a private
      window.
    </p>
    <a
      :href="login.authorizationUrl.value ?? '#'"
      target="_blank"
      rel="noopener"
      class="authorization-link"
    >
      <ArrowSquareOut :size="12" aria-hidden="true" />
      {{ login.authorizationUrl.value }}
    </a>
    <input
      v-model="pastedCode"
      type="text"
      spellcheck="false"
      placeholder="Paste the code from your browser"
      class="code-input"
      @keydown.enter.prevent="submitCode"
    />
    <div class="flex gap-2">
      <button type="button" class="primary-button" @click="submitCode">
        Finish sign-in
      </button>
      <button type="button" class="ghost-button" @click="login.cancel()">
        Cancel
      </button>
    </div>
  </div>

  <p v-else-if="login.phase.value === 'finishing'" class="flow-panel flow-note">
    <CircleNotch :size="13" class="spin" aria-hidden="true" />
    Finishing the sign-in…
  </p>

  <div v-else class="flow-panel is-error">
    <p class="error-lead">
      <WarningCircle :size="14" aria-hidden="true" />
      That sign-in did not finish
    </p>
    <p class="flow-note">{{ login.errorMessage.value }}</p>
    <div class="flex gap-2">
      <button type="button" class="primary-button" @click="login.begin()">
        Try again
      </button>
      <button type="button" class="ghost-button" @click="login.cancel()">
        Close
      </button>
    </div>
  </div>
</template>

<style scoped>
.flow-note {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
  text-wrap: pretty;
}

.error-lead {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--danger);
  font: 400 12.5px/1.6 var(--font-ui);
}

.spin {
  animation: flow-spin 1.1s linear infinite;
  flex: none;
}

@keyframes flow-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

/* The flow's one panel — each state swaps its content. */
.flow-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 13px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
}

.flow-panel.is-error {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.flow-lead {
  margin: 0;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.authorization-link {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-shell);
  color: var(--ink-2);
  font: 400 11px/1.5 var(--font-mono);
  word-break: break-all;
  text-decoration: none;
}

.authorization-link:hover {
  color: var(--ink-1);
  border-color: var(--claude-mark);
}

.code-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-shell);
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
}

.code-input::placeholder {
  color: var(--ink-3);
}

.primary-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--claude-mark);
  border-radius: var(--radius-s);
  padding: 6px 13px;
  background: var(--claude-mark-soft);
  color: var(--ink-1);
  font: 600 12px/1.5 var(--font-ui);
  cursor: pointer;
}

.primary-button:hover {
  background: color-mix(in srgb, var(--claude-mark) 24%, transparent);
}

.ghost-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  padding: 5px 11px;
  background: transparent;
  color: var(--ink-3);
  font: 500 12px/1.5 var(--font-ui);
  cursor: pointer;
}

.ghost-button:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}
</style>
