<script setup lang="ts">
import { computed } from "vue";
import {
  PhArrowLeft as ArrowLeft,
  PhArrowUp as ArrowUp,
  PhCaretRight as CaretRight,
  PhFolderPlus as FolderPlus,
} from "@phosphor-icons/vue";
import type { PathCrumb } from "./file-system-path.js";

// Explorer's top strip: back, up, the clickable address crumbs
// ("This PC › WORKSPACE (E:) › KLONE"), and "New folder" on the right. Deep
// paths keep their LAST crumbs visible — those are the ones you're standing
// in — and fold the rest behind an ellipsis that jumps one level above the
// visible run.
const props = defineProps<{
  /** Already dressed for display (the root crumb reads as its drive name). */
  crumbs: PathCrumb[];
  canGoBack: boolean;
  canGoUp: boolean;
  showingThisPc: boolean;
  /** False while no real folder is open ("This PC") — nothing to create inside. */
  canCreateFolder: boolean;
}>();

const emit = defineEmits<{
  back: [];
  up: [];
  navigate: [path: string];
  openThisPc: [];
  newFolder: [];
}>();

const MAX_VISIBLE_CRUMBS = 4;

const visibleCrumbs = computed(() =>
  props.crumbs.length > MAX_VISIBLE_CRUMBS
    ? props.crumbs.slice(-MAX_VISIBLE_CRUMBS)
    : props.crumbs,
);
const foldedCrumb = computed(() =>
  props.crumbs.length > MAX_VISIBLE_CRUMBS
    ? props.crumbs[props.crumbs.length - MAX_VISIBLE_CRUMBS - 1]!
    : null,
);
</script>

<template>
  <div class="flex items-center gap-1 border-b border-hair px-2 py-1.5">
    <button
      type="button"
      class="fs-back grid h-6 w-6 cursor-default place-items-center rounded-sm text-ink-2 outline-none transition enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-35 focus-visible:ring-1 focus-visible:ring-gold"
      :disabled="!props.canGoBack"
      title="Back"
      aria-label="Back"
      @click="emit('back')"
    >
      <ArrowLeft :size="14" />
    </button>
    <button
      type="button"
      class="fs-up grid h-6 w-6 cursor-default place-items-center rounded-sm text-ink-2 outline-none transition enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-35 focus-visible:ring-1 focus-visible:ring-gold"
      :disabled="!props.canGoUp"
      title="Up one folder"
      aria-label="Up one folder"
      @click="emit('up')"
    >
      <ArrowUp :size="14" />
    </button>

    <div
      class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-sm border border-hair bg-inset px-1.5 py-[3px] text-[11.5px]"
      aria-label="Current location"
    >
      <button
        type="button"
        class="fs-crumb shrink-0 cursor-default rounded-sm px-1 py-px outline-none transition hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-gold"
        :class="props.showingThisPc ? 'font-semibold text-ink-1' : 'text-ink-2'"
        @click="emit('openThisPc')"
      >
        This PC
      </button>
      <template v-if="!props.showingThisPc">
        <template v-if="foldedCrumb">
          <CaretRight :size="10" class="shrink-0 text-ink-3" />
          <button
            type="button"
            class="fs-crumb shrink-0 cursor-default rounded-sm px-1 py-px text-ink-2 outline-none transition hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-gold"
            :title="foldedCrumb.path"
            @click="emit('navigate', foldedCrumb.path)"
          >
            …
          </button>
        </template>
        <template v-for="(crumb, index) in visibleCrumbs" :key="crumb.path">
          <CaretRight :size="10" class="shrink-0 text-ink-3" />
          <button
            type="button"
            class="fs-crumb min-w-0 cursor-default overflow-hidden text-ellipsis whitespace-nowrap rounded-sm px-1 py-px outline-none transition hover:bg-row-hover focus-visible:ring-1 focus-visible:ring-gold"
            :class="index === visibleCrumbs.length - 1 ? 'font-semibold text-ink-1' : 'text-ink-2'"
            :title="crumb.path"
            @click="emit('navigate', crumb.path)"
          >
            {{ crumb.name }}
          </button>
        </template>
      </template>
    </div>

    <button
      type="button"
      class="fs-new-folder inline-flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-sm border border-hair px-2 text-[11.5px] font-medium text-ink-2 outline-none transition enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-35 focus-visible:ring-1 focus-visible:ring-gold"
      :disabled="!props.canCreateFolder"
      title="Make a new folder here"
      @click="emit('newFolder')"
    >
      <FolderPlus :size="14" />
      New folder
    </button>
  </div>
</template>
