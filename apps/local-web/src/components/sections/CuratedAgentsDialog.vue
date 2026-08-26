<script setup lang="ts">
import { computed, watch } from "vue";
import { PhRobot as Bot } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import { useCuratedAgents } from "../../composables/agents/use-curated-agents.js";
import { useInstallCuratedAgent } from "../../composables/agents/use-agent-mutations.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// The curated catalog — specialists Vynel ships, installed with one click
// at the surface's scope. The API and its tools existed since July; this is
// the human door the audit found missing (2026-08-26).
const props = defineProps<{
  open: boolean;
  scope: SectionScope;
  /** Slugs already installed at this scope — their row reads "Added". */
  installedSlugs: readonly string[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const catalogQuery = useCuratedAgents({ enabled: () => props.open });
const catalog = computed(() => catalogQuery.data.value ?? []);
const install = useInstallCuratedAgent();

// A failed Add must not greet the next opening as a stale red line.
watch(
  () => props.open,
  (open) => {
    if (open) install.reset();
  },
);

const errorMessage = computed(() =>
  install.error.value ? formatSdkError(install.error.value) : null,
);

function add(slug: string) {
  install.mutate(
    props.scope.kind === "workspace"
      ? { slug, scope: "workspace", workspaceId: props.scope.workspaceId }
      : { slug, scope: "user" },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Add from the catalog"
    description="Specialists Vynel ships. Add one and Claude can delegate to it here."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-2 pt-1">
      <div
        v-for="entry in catalog"
        :key="entry.slug"
        class="curated-row flex items-center gap-3 rounded-lg border border-hair bg-raised p-3"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-md bg-ok/10 text-ok">
          <Bot :size="17" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate text-sm font-semibold text-ink-1">{{ entry.name }}</p>
          <p class="m-0 mt-0.5 line-clamp-2 text-xs text-ink-3">{{ entry.description }}</p>
        </div>
        <span
          v-if="props.installedSlugs.includes(entry.slug)"
          class="shrink-0 rounded-full border border-hair-strong px-2.5 py-0.5 text-[11px] font-semibold text-ink-3"
          >Added</span
        >
        <button
          v-else
          type="button"
          class="add-curated shrink-0 cursor-default rounded-full bg-gold px-3 py-0.5 text-[11px] font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
          :disabled="install.isPending.value"
          @click="add(entry.slug)"
        >
          Add
        </button>
      </div>
      <p v-if="catalog.length === 0 && !catalogQuery.isPending.value" class="m-0 text-xs text-ink-3">
        The catalog is empty in this build.
      </p>
      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Done
      </button>
    </template>
  </Modal>
</template>
