<script setup lang="ts">
import { computed } from "vue";
import { Modal } from "@vynel/ui";
import { useProjectSetup } from "../../composables/workspaces/use-project-setup.js";
import { useAiProviders } from "../../composables/providers/use-ai-providers.js";
import { useMarkSetupComplete } from "../../composables/workspaces/use-mark-setup-complete.js";
import { buildSetupRows } from "./finish-setup-rows.js";
import SetupSummaryRow from "./SetupSummaryRow.vue";

// "Finish setting up" — opens on a project pulled in from disk, which starts
// under NEEDS SETUP (Chad, 2026-08-25). Everything the folder can answer is
// READ and shown (repository, .env key names, database); the one thing it
// cannot — which account builds — is a link out to the global account. So
// there is nothing to fill in and Done is always ready; it stamps the project
// set up, which is what moves it out of Needs setup.
const props = defineProps<{
  open: boolean;
  workspace: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  close: [];
  done: [workspaceId: string];
  "connect-account": [];
}>();

const workspaceId = computed(() => props.workspace?.id ?? null);
const setupQuery = useProjectSetup(workspaceId);
const { signedIn } = useAiProviders();
const markComplete = useMarkSetupComplete();

// The account that would build — the first signed-in provider, named. Null
// when none is connected, which the account row turns into a link out.
const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  cursor: "Cursor",
};
const builderLabel = computed(() => {
  const provider = signedIn.value[0];
  if (provider === undefined) return null;
  const name = PROVIDER_NAMES[provider.providerId] ?? provider.providerId;
  const account = provider.authenticatedAccountLabel ?? provider.email;
  return account ? `${name} — ${account}` : name;
});

const rows = computed(() => {
  const setup = setupQuery.data.value;
  if (setup === undefined) return [];
  return buildSetupRows(setup, builderLabel.value);
});

const blurb = computed(() =>
  setupQuery.data.value === undefined
    ? "Reading the folder…"
    : "We read the folder and answered everything we could. Nothing in the folder has been touched.",
);

function onOpenChange(next: boolean) {
  if (!next) emit("close");
}

async function done() {
  const id = workspaceId.value;
  if (id === null || markComplete.isPending.value) return;
  await markComplete.mutateAsync(id);
  emit("done", id);
}
</script>

<template>
  <Modal
    :open="open"
    :title="props.workspace?.name ?? 'Finish setting up'"
    :description="blurb"
    size="lg"
    @update:open="onOpenChange"
  >
    <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
      Finish setting up
    </span>
    <ul class="m-0 mt-1 grid list-none gap-0 p-0">
      <SetupSummaryRow
        v-for="row in rows"
        :key="row.id"
        :row="row"
        @connect-account="emit('connect-account')"
      />
    </ul>

    <template #footer>
      <button
        type="button"
        class="mr-auto text-[12.5px] text-ink-3 transition hover:text-ink-1"
        @click="emit('close')"
      >
        Skip for now
      </button>
      <button
        type="button"
        class="rounded-md bg-gold px-4 py-2 text-[12.5px] font-semibold text-shell transition disabled:opacity-55"
        :disabled="markComplete.isPending.value || workspace === null"
        @click="done()"
      >
        {{ markComplete.isPending.value ? "Saving…" : "Done — start building" }}
      </button>
    </template>
  </Modal>
</template>
