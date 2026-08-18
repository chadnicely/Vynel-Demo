<script setup lang="ts">
import { computed } from "vue";
import {
  PhFile as File,
  PhFileCode as FileCode,
  PhBracketsCurly as FileJson,
  PhFileText as FileText,
  PhFolder as Folder,
  PhImage as Image,
} from "@phosphor-icons/vue";
import { fileColorFamily } from "../../utils/file-colors.js";

// One large-icon tile in the browser pane — Explorer's "Large icons" view: a
// big glyph with the name wrapped underneath. Click highlights, double-click
// (or Enter) opens a folder; the parent decides what a highlight means.
const props = defineProps<{
  kind: "folder" | "file";
  name: string;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [];
  open: [];
}>();

const FILE_ICONS = {
  folder: Folder,
  doc: FileText,
  data: FileJson,
  image: Image,
  code: FileCode,
  plain: File,
} as const;

const family = computed(() =>
  props.kind === "folder" ? "folder" : fileColorFamily(props.name),
);
const icon = computed(() => FILE_ICONS[family.value]);

function onEnter() {
  if (props.kind === "folder") emit("open");
  else emit("select");
}
</script>

<template>
  <button
    type="button"
    class="fs-tile flex w-full cursor-default flex-col items-center gap-1 rounded-sm px-1 pb-1.5 pt-2 text-center outline-none transition focus-visible:ring-1 focus-visible:ring-gold"
    :class="[
      props.kind === 'folder' ? 'fs-tile-folder' : 'fs-tile-file',
      props.selected ? 'bg-row-active' : 'hover:bg-row-hover',
    ]"
    :title="props.name"
    :aria-pressed="props.selected"
    @click="emit('select')"
    @dblclick="props.kind === 'folder' && emit('open')"
    @keydown.enter.prevent="onEnter"
  >
    <component
      :is="icon"
      :size="40"
      :weight="props.kind === 'folder' ? 'fill' : 'duotone'"
      class="shrink-0"
      :class="`fs-tile-icon-${family}`"
    />
    <span class="line-clamp-2 w-full break-words text-[11.5px] leading-[1.25] text-ink-1">
      {{ props.name }}
    </span>
  </button>
</template>

<style scoped>
.fs-tile-icon-folder {
  color: var(--file-folder);
}
.fs-tile-icon-doc {
  color: var(--file-doc);
}
.fs-tile-icon-data {
  color: var(--file-data);
}
.fs-tile-icon-image {
  color: var(--file-image);
}
.fs-tile-icon-code {
  color: var(--file-code);
}
.fs-tile-icon-plain {
  color: var(--ink-3);
}
</style>
