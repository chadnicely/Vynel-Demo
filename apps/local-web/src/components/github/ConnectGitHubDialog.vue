<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhCheckCircle,
  PhGithubLogo,
  PhWarningCircle,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import GitHubRepositoryFields from "./GitHubRepositoryFields.vue";
import { useGitHubConnection } from "../../composables/github/use-github-connection.js";
import {
  suggestRepositoryName,
  useCreateGitHubRepository,
  type GitHubRepositoryOutcome,
  type RepositoryVisibility,
} from "../../composables/github/use-github-repository.js";
import { REPOSITORY_NAME_PATTERN } from "@vynel/contracts/github/github-repository";
import { basenameOfPath } from "../filesystem/file-system-path.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// "Connect to GitHub" on a workspace that already exists (the header's door
// when its repository has no remote): the same `gh repo create --source
// --push` the wizard's Finish runs, with the same two fields. Not signed in
// is said plainly with the way to Settings — never a dead button.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  workspacePath: string;
}>();

const emit = defineEmits<{
  close: [];
  /** Open Settings → GitHub — the shell decides how. */
  openSettings: [];
}>();

const github = useGitHubConnection(() => props.open);
const create = useCreateGitHubRepository();

const name = ref("");
const visibility = ref<RepositoryVisibility>("private");
const outcome = ref<GitHubRepositoryOutcome | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = suggestRepositoryName(basenameOfPath(props.workspacePath));
    visibility.value = "private";
    outcome.value = null;
    create.reset();
  },
  { immediate: true },
);

const signedInAs = computed(() =>
  github.data.value?.isAuthenticated === true
    ? (github.data.value.accountLabel ?? "you")
    : null,
);

const gate = computed<string | null>(() => {
  if (name.value.trim() === "") return "Give the repository a name.";
  if (!REPOSITORY_NAME_PATTERN.test(name.value.trim()))
    return "Letters, digits, dots, dashes and underscores only.";
  return null;
});

async function submit() {
  if (gate.value !== null) return;
  try {
    outcome.value = await create.mutateAsync({
      workspaceId: props.workspaceId,
      name: name.value.trim(),
      visibility: visibility.value,
    });
  } catch (error) {
    outcome.value = { kind: "failed", reason: formatSdkError(error) };
  }
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Connect to GitHub"
    description="Create the repository on GitHub and push what is in the folder. Your sessions take it from there."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div
        v-if="github.isPending.value"
        class="flex items-center gap-2 text-[12.5px] text-ink-2"
      >
        <span class="size-2 animate-pulse rounded-full bg-gold" />
        Checking your GitHub sign-in…
      </div>

      <div
        v-else-if="signedInAs === null"
        class="flex items-start gap-3 rounded-md border border-hair bg-panel p-3.5"
        data-testid="not-signed-in"
      >
        <PhWarningCircle
          :size="20"
          class="shrink-0 text-needs-input"
          weight="fill"
        />
        <span class="grid min-w-0 flex-1 gap-1">
          <span class="text-[13px] text-ink-1">
            {{
              github.data.value?.isInstalled === false
                ? "The GitHub CLI is not installed"
                : "GitHub — not signed in"
            }}
          </span>
          <span class="text-[11.5px] text-ink-3">
            Sign in once under Settings → GitHub; it is the account every
            workspace pushes through.
          </span>
        </span>
        <button
          type="button"
          class="cursor-default rounded-sm border border-hair-strong px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="emit('openSettings')"
        >
          Open Settings
        </button>
      </div>

      <template v-else-if="outcome?.kind === 'created'">
        <p
          class="m-0 flex items-start gap-2 text-[12.5px] text-ink-1"
          data-testid="repository-created"
        >
          <PhCheckCircle
            :size="16"
            class="mt-0.5 shrink-0 text-gold"
            weight="fill"
          />
          <span>
            Created and pushed —
            <a
              v-if="outcome.url"
              :href="outcome.url"
              target="_blank"
              rel="noreferrer"
              class="text-gold underline-offset-2 hover:underline"
              >{{ outcome.url }}</a
            >
            <template v-else>the repository is on GitHub.</template>
          </span>
        </p>
      </template>

      <template v-else>
        <p class="m-0 flex items-center gap-2 text-[12px] text-ink-3">
          <PhGithubLogo :size="14" />
          Signed in as @{{ signedInAs }}
        </p>
        <GitHubRepositoryFields
          :name="name"
          :visibility="visibility"
          :disabled="create.isPending.value"
          @update:name="name = $event"
          @update:visibility="visibility = $event"
        />
        <p
          v-if="outcome?.kind === 'failed'"
          class="m-0 flex items-start gap-2 text-[12px] text-needs-input"
          data-testid="repository-failed"
        >
          <PhWarningCircle :size="14" class="mt-0.5 shrink-0" />
          <span>{{ outcome.reason }}</span>
        </p>
      </template>
    </div>

    <template #footer>
      <span class="flex-1 text-[12px] text-ink-3">
        {{
          signedInAs !== null && outcome?.kind !== "created" ? (gate ?? "") : ""
        }}
      </span>
      <button
        v-if="outcome?.kind === 'created' || signedInAs === null"
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright"
        @click="emit('close')"
      >
        {{ outcome?.kind === "created" ? "Done" : "Close" }}
      </button>
      <button
        v-else
        type="button"
        class="connect cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="gate !== null || create.isPending.value"
        @click="submit"
      >
        {{ create.isPending.value ? "Creating…" : "Create and push" }}
      </button>
    </template>
  </Modal>
</template>
