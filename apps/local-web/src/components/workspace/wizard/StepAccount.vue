<script setup lang="ts">
import {
  PhCheck,
  PhCheckCircle,
  PhGithubLogo,
  PhSignIn,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import type { VynelClient } from "@vynel/sdk";
import GitHubRepositoryFields from "../../github/GitHubRepositoryFields.vue";
import { useWizardAnswers } from "./wizard-answers.js";
import {
  CARD,
  HINT,
  PRIMARY_BUTTON,
  TICK_BOX,
  TICK_BOX_ON,
} from "./wizard-classes.js";

/** The wire shape of the account read — typed off the SDK, as every screen is. */
type AuthenticationStatus = Awaited<
  ReturnType<VynelClient["providers"]["getAuthStatus"]>
>;

// Screen 10 — the account that builds. Accounts are GLOBAL (Kafi,
// 2026-08-23): one Claude account for the whole app, never a per-workspace
// pick. So this is a read-only pre-flight — signed in? — with the sign-in
// door when not; and GitHub shown dimmed until the global connection exists.
// The one thing chosen here: whether Finish also makes the GitHub repository
// (name + visibility) — offered only when the global sign-in exists.
defineProps<{
  status: AuthenticationStatus | null;
  loading: boolean;
  /** The global GitHub sign-in — the handle when signed in, null otherwise. */
  github: { accountLabel: string } | null;
}>();

const emit = defineEmits<{ signIn: [] }>();

const answers = useWizardAnswers();
</script>

<template>
  <div :class="CARD" class="flex items-center gap-3">
    <template v-if="loading">
      <span class="size-2 animate-pulse rounded-full bg-gold" />
      <span class="text-[12.5px] text-ink-2"
        >Checking your Claude account…</span
      >
    </template>
    <template v-else-if="status?.isAuthenticated">
      <PhCheckCircle :size="20" class="shrink-0 text-gold" weight="fill" />
      <span class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-[13px] text-ink-1">Claude — signed in</span>
        <span class="truncate text-[11.5px] text-ink-3">
          {{
            status.email ?? status.authenticatedAccountLabel ?? "your account"
          }}
          <template v-if="status.organizationName">
            · {{ status.organizationName }}</template
          >
        </span>
      </span>
      <span
        v-if="status.subscriptionPlan"
        class="rounded-full border border-hair-strong px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-ink-2"
      >
        {{ status.subscriptionPlan }}
      </span>
    </template>
    <template v-else>
      <PhWarningCircle
        :size="20"
        class="shrink-0 text-needs-input"
        weight="fill"
      />
      <span class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-[13px] text-ink-1">
          {{
            status?.isInstalled === false
              ? "Claude Code is not installed"
              : "Claude — not signed in"
          }}
        </span>
        <span class="text-[11.5px] text-ink-3">
          {{
            status?.isInstalled === false
              ? "Vynel builds through Claude Code; install it and come back to this step."
              : "Sign in once — it is the account every workspace builds with."
          }}
        </span>
      </span>
      <button
        v-if="status?.isInstalled !== false"
        type="button"
        :class="PRIMARY_BUTTON"
        @click="emit('signIn')"
      >
        <PhSignIn :size="13" /> Sign in
      </button>
    </template>
  </div>

  <div v-if="github" :class="CARD" class="grid gap-3">
    <div class="flex items-center gap-3">
      <PhGithubLogo :size="20" class="shrink-0 text-gold" />
      <span class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-[13px] text-ink-1"
          >GitHub — signed in as @{{ github.accountLabel }}</span
        >
        <span class="text-[11.5px] text-ink-3">
          Your sessions push and open pull requests through this account.
        </span>
      </span>
    </div>
    <button
      type="button"
      role="checkbox"
      :aria-checked="answers.repository.create"
      class="flex w-full cursor-default items-center gap-2.5 rounded-sm px-1 py-1 text-left text-[12.5px] text-ink-1 transition hover:bg-row-hover"
      @click="answers.repository.create = !answers.repository.create"
    >
      <span :class="[TICK_BOX, answers.repository.create ? TICK_BOX_ON : '']">
        <PhCheck v-if="answers.repository.create" :size="11" weight="bold" />
      </span>
      <span class="grid gap-0.5">
        <span>Also create the repository on GitHub when I finish</span>
        <span class="text-[11px] text-ink-3"
          >The first commit is pushed; the sessions take it from there.</span
        >
      </span>
    </button>
    <GitHubRepositoryFields
      v-if="answers.repository.create"
      :name="answers.repository.name"
      :visibility="answers.repository.visibility"
      @update:name="answers.repository.name = $event"
      @update:visibility="answers.repository.visibility = $event"
    />
  </div>
  <div v-else :class="CARD" class="flex items-center gap-3 opacity-70">
    <PhGithubLogo :size="20" class="shrink-0 text-ink-3" />
    <span class="grid min-w-0 flex-1 gap-0.5">
      <span class="text-[13px] text-ink-2">GitHub — not connected</span>
      <span class="text-[11.5px] text-ink-3">
        Optional. Your workspace keeps its own history either way; sign in under
        Settings → GitHub for everything at once.
      </span>
    </span>
  </div>

  <p class="m-0" :class="HINT">
    Accounts belong to Vynel as a whole, not to one workspace — change them any
    time from the account menu.
  </p>
</template>
