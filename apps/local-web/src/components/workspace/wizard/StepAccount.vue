<script setup lang="ts">
import {
  PhCheckCircle,
  PhGithubLogo,
  PhSignIn,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import type { VynelClient } from "@vynel/sdk";
import { CARD, HINT, PRIMARY_BUTTON } from "./wizard-classes.js";

/** The wire shape of the account read — typed off the SDK, as every screen is. */
type AuthenticationStatus = Awaited<
  ReturnType<VynelClient["providers"]["getAuthStatus"]>
>;

// Screen 10 — the account that builds. Accounts are GLOBAL (Kafi,
// 2026-08-23): one Claude account for the whole app, never a per-workspace
// pick. So this is a read-only pre-flight — signed in? — with the sign-in
// door when not; and GitHub shown dimmed until the global connection exists.
// Nothing here is stored on the workspace.
defineProps<{ status: AuthenticationStatus | null; loading: boolean }>();

const emit = defineEmits<{ signIn: [] }>();
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

  <div :class="CARD" class="flex items-center gap-3 opacity-70">
    <PhGithubLogo :size="20" class="shrink-0 text-ink-3" />
    <span class="grid min-w-0 flex-1 gap-0.5">
      <span class="text-[13px] text-ink-2">GitHub — not connected</span>
      <span class="text-[11.5px] text-ink-3">
        Optional. Your workspace keeps its own history either way; a GitHub copy
        can be connected later in Settings, for everything at once.
      </span>
    </span>
  </div>

  <p class="m-0" :class="HINT">
    Accounts belong to Vynel as a whole, not to one workspace — change them any
    time from the account menu.
  </p>
</template>
