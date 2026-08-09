<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import {
  useAddMarketplaceSource,
  useMarketplaceSources,
  useRemoveMarketplaceSource,
} from "../../composables/marketplace/use-marketplace-sources.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Register/remove Claude plugin marketplaces — the trust door for
// third-party sources, so the warning is part of the form, not a footnote.
// Remove arms first (the marketplace-card idiom): its plugins leave the
// shelf, though already-installed ones keep working via Claude Code.
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const sourcesQuery = useMarketplaceSources(() => props.open);
const sources = computed(() => sourcesQuery.data.value ?? []);

const addSource = useAddMarketplaceSource();
const removeSource = useRemoveMarketplaceSource();

const sourceText = ref("");
const armedRemoveName = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    sourceText.value = "";
    armedRemoveName.value = null;
    addSource.reset();
    removeSource.reset();
  },
  { immediate: true },
);

const canAdd = computed(
  () => sourceText.value.trim().length > 2 && !addSource.isPending.value,
);

function submitAdd() {
  if (!canAdd.value) return;
  addSource.mutate(
    { source: sourceText.value.trim() },
    { onSuccess: () => (sourceText.value = "") },
  );
}

function requestRemove(marketplaceName: string) {
  if (armedRemoveName.value !== marketplaceName) {
    armedRemoveName.value = marketplaceName;
    return;
  }
  armedRemoveName.value = null;
  removeSource.mutate({ marketplaceName });
}

const errorMessage = computed(() => {
  if (addSource.error.value) return formatSdkError(addSource.error.value);
  if (removeSource.error.value) return formatSdkError(removeSource.error.value);
  return null;
});

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Marketplaces"
    description="Sources whose plugins appear on your shelf, alongside Vynel's own catalog."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <ul v-if="sources.length > 0" class="m-0 flex list-none flex-col gap-1.5 p-0">
        <li
          v-for="source in sources"
          :key="source.marketplaceName"
          class="flex items-center gap-2 rounded-sm border border-hair bg-panel px-2.5 py-1.5"
        >
          <div class="min-w-0 flex-1">
            <p class="m-0 truncate text-[12.5px] font-semibold text-ink-1">
              {{ source.marketplaceName }}
              <span class="font-normal text-ink-3">
                · {{ source.pluginCount }}
                {{ source.pluginCount === 1 ? "plugin" : "plugins" }}</span
              >
            </p>
            <p class="m-0 truncate text-2xs text-ink-3">
              <template v-if="source.ownerName">{{ source.ownerName }} · </template>
              <a
                v-if="source.sourceUrl"
                :href="source.sourceUrl"
                target="_blank"
                rel="noreferrer"
                class="underline decoration-hair-strong underline-offset-2 hover:text-ink-1"
                >{{ source.sourceUrl }}</a
              >
            </p>
          </div>
          <button
            type="button"
            class="row-action inline-flex shrink-0 cursor-default items-center rounded-full border px-2.5 py-px text-[11px] font-semibold transition disabled:opacity-55"
            :class="
              armedRemoveName === source.marketplaceName
                ? 'is-danger border-danger/40 text-danger hover:border-danger hover:bg-danger/10'
                : 'border-hair text-ink-2 hover:border-hair-strong hover:bg-row-hover hover:text-ink-1'
            "
            :disabled="removeSource.isPending.value"
            :aria-label="
              armedRemoveName === source.marketplaceName
                ? `Confirm remove marketplace ${source.marketplaceName}`
                : `Remove marketplace ${source.marketplaceName}`
            "
            @click="requestRemove(source.marketplaceName)"
            @blur="armedRemoveName = null"
          >
            {{ armedRemoveName === source.marketplaceName ? "Sure?" : "Remove" }}
          </button>
        </li>
      </ul>
      <p v-else class="m-0 text-xs text-ink-3">
        No marketplaces added yet — everything on your shelf comes from Vynel's catalog.
      </p>

      <form class="grid gap-1.5" @submit.prevent="submitAdd">
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">Add a marketplace</span>
          <input
            v-model="sourceText"
            type="text"
            maxlength="300"
            placeholder="owner/repo or https://…/marketplace.git"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <p class="teaching-note m-0 text-[11px] text-ink-3">
          A marketplace's plugins can run code and connect tools on your
          machine once installed — only add sources you trust. Its items are
          marked as community, never as verified.
        </p>
      </form>

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
        Close
      </button>
      <button
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canAdd"
        @click="submitAdd"
      >
        {{ addSource.isPending.value ? "Adding…" : "Add marketplace" }}
      </button>
    </template>
  </Modal>
</template>
