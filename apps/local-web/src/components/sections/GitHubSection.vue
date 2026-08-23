<script setup lang="ts">
import { computed } from "vue";
import { PhGithubLogo as GithubLogo } from "@phosphor-icons/vue";
import {
  useGitHubConnection,
  useGitHubSignIn,
  useGitHubSignOut,
} from "../../composables/github/use-github-connection.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import SectionHeader from "./SectionHeader.vue";

// Settings → GitHub: the app's ONE GitHub sign-in (global — never per
// workspace), entirely over the GitHub CLI. Three honest states: the CLI is
// missing (say how to get it), signed out (sign in here — the code and the
// URL come from gh itself), signed in (as whom, and a way out). Vynel never
// sees the token.

const connection = useGitHubConnection();
const signIn = useGitHubSignIn();
const signOut = useGitHubSignOut();

const status = computed(() => connection.data.value ?? null);
const failure = computed(
  () =>
    signIn.errorMessage.value ??
    (signOut.error.value ? formatSdkError(signOut.error.value) : null),
);

const INSTALL_COMMAND = "winget install GitHub.cli";
</script>

<template>
  <div class="github-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="GithubLogo"
      title="GitHub"
      subtitle="One sign-in for the whole app. Vynel uses the GitHub CLI you sign in with — it keeps the credential, Vynel never sees it — and your sessions create repositories and push through it."
    />

    <p
      v-if="connection.error.value"
      class="m-0 text-xs text-danger"
      role="alert"
    >
      Couldn’t read the GitHub sign-in —
      {{ formatSdkError(connection.error.value) }}
    </p>
    <p v-else-if="connection.isPending.value" class="m-0 text-xs text-ink-3">
      Checking…
    </p>

    <template v-else-if="status && !status.isInstalled">
      <div class="rounded-md border border-hair bg-panel p-3.5">
        <p class="m-0 text-[13px] text-ink-1">
          The GitHub CLI is not installed
        </p>
        <p class="m-0 mt-1 text-[12px] leading-relaxed text-ink-2">
          Vynel talks to GitHub through GitHub’s own command-line tool,
          <code>gh</code>. Install it, then come back here to sign in.
        </p>
        <p class="m-0 mt-2 text-[12px] text-ink-2">
          On Windows, in a terminal:
          <code
            class="rounded-sm bg-raised px-1.5 py-0.5 text-[11.5px] text-ink-1"
            >{{ INSTALL_COMMAND }}</code
          >
          — or download it from
          <a
            class="text-gold underline-offset-2 hover:underline"
            href="https://cli.github.com"
            target="_blank"
            rel="noreferrer"
            >cli.github.com</a
          >.
        </p>
      </div>
    </template>

    <template v-else-if="status?.isAuthenticated">
      <div
        class="flex items-center gap-3 rounded-md border border-hair bg-panel p-3.5"
      >
        <GithubLogo :size="22" class="shrink-0 text-gold" />
        <span class="grid min-w-0 flex-1 gap-0.5">
          <span class="text-[13px] text-ink-1"
            >Signed in as @{{ status.accountLabel }}</span
          >
          <span class="text-[11.5px] text-ink-3">
            Your sessions create repositories and push as this account. Pushes use
            Git’s own credential helper.
          </span>
        </span>
        <button
          type="button"
          class="sign-out cursor-default rounded-sm border border-hair-strong px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
          :disabled="signOut.isPending.value"
          @click="signOut.mutate()"
        >
          {{ signOut.isPending.value ? "Signing out…" : "Sign out" }}
        </button>
      </div>
    </template>

    <template v-else>
      <div class="grid gap-3 rounded-md border border-hair bg-panel p-3.5">
        <template v-if="signIn.state.value?.phase === 'awaiting-browser'">
          <p class="m-0 text-[13px] text-ink-1">Finish signing in on GitHub</p>
          <p class="m-0 text-[12px] leading-relaxed text-ink-2">
            Open the page below, enter this code, and approve. Vynel notices the
            moment it lands.
          </p>
          <code
            class="user-code w-fit rounded-md bg-raised px-4 py-2 text-[22px] tracking-[0.3em] text-ink-1"
            >{{ signIn.state.value.userCode }}</code
          >
          <a
            class="text-[12.5px] text-gold underline-offset-2 hover:underline"
            :href="
              signIn.state.value.verificationUrl ??
              'https://github.com/login/device'
            "
            target="_blank"
            rel="noreferrer"
          >
            {{
              signIn.state.value.verificationUrl ??
              "https://github.com/login/device"
            }}
          </a>
          <div class="flex items-center gap-2.5 text-[12px] text-ink-3">
            <span class="size-2 animate-pulse rounded-full bg-gold" />
            Waiting for you to approve it…
            <button
              type="button"
              class="cursor-default text-ink-2 underline-offset-2 hover:underline"
              @click="signIn.cancel()"
            >
              Cancel
            </button>
          </div>
        </template>
        <template v-else>
          <p class="m-0 text-[13px] text-ink-1">Not signed in</p>
          <p class="m-0 text-[12px] leading-relaxed text-ink-2">
            One button, one code, approved in your browser — no passwords here.
          </p>
          <p
            v-if="signIn.state.value?.phase === 'failed'"
            class="m-0 text-xs text-danger"
            role="alert"
          >
            {{ signIn.state.value.errorMessage }}
          </p>
          <div>
            <button
              type="button"
              class="sign-in cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
              :disabled="signIn.isBeginning.value"
              @click="signIn.begin()"
            >
              {{ signIn.isBeginning.value ? "Starting…" : "Sign in to GitHub" }}
            </button>
          </div>
        </template>
      </div>
    </template>

    <p v-if="failure" class="m-0 text-xs text-danger" role="alert">
      {{ failure }}
    </p>
  </div>
</template>
