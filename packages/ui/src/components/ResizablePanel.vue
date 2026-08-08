<script setup lang="ts">
import { computed, watch } from "vue";
import { usePanelResize } from "./use-panel-resize.js";

// A side panel with a draggable divider on its inner edge (the brief's
// signature interaction): pointer-drag or keyboard resize, min/max clamp,
// double-click reset, width persisted. The mechanics live in
// `usePanelResize` — the one home shared with the conversation sidebar.
const props = withDefaults(
  defineProps<{
    side: "left" | "right";
    storageKey: string;
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
  }>(),
  { defaultWidth: 260, minWidth: 180, maxWidth: 480 },
);

const collapsed = defineModel<boolean>("collapsed", { default: false });

const emit = defineEmits<{
  resize: [width: number];
}>();

const { width, dragging, startResize, onKeydown, reset } = usePanelResize({
  side: props.side,
  storageKey: props.storageKey,
  defaultWidth: props.defaultWidth,
  minWidth: props.minWidth,
  maxWidth: props.maxWidth,
});

// Live signal every frame; persistence waits for the gesture to settle so we
// don't hammer localStorage on every pointer move.
watch(width, (value) => emit("resize", value));

defineExpose({ reset });

const panelStyle = computed(() => ({ width: `${width.value}px` }));
</script>

<template>
  <div
    v-show="!collapsed"
    class="relative h-full shrink-0"
    :class="
      props.side === 'left' ? 'border-r border-hair' : 'border-l border-hair'
    "
    :style="panelStyle"
  >
    <div class="h-full overflow-hidden">
      <slot />
    </div>

    <div
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="`Resize ${props.side} panel`"
      :aria-valuenow="Math.round(width)"
      :aria-valuemin="props.minWidth"
      :aria-valuemax="props.maxWidth"
      class="group absolute top-0 z-20 flex h-full w-2 cursor-col-resize touch-none items-stretch outline-none"
      :class="props.side === 'left' ? '-right-1' : '-left-1'"
      @pointerdown="startResize"
      @dblclick="reset"
      @keydown="onKeydown"
    >
      <span
        class="mx-auto h-full w-px transition-colors group-hover:bg-hair-strong group-focus-visible:bg-ink-3"
        :class="dragging ? 'bg-ink-3' : 'bg-transparent'"
      />
    </div>
  </div>
</template>
