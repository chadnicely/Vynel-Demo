<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

// A side panel with a draggable divider on its inner edge. Hand-rolled (the
// brief's signature interaction): pointer-drag or keyboard resize, min/max
// clamp, double-click reset, and width PERSISTED to localStorage so a reload
// returns you to your layout.
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

function clamp(value: number): number {
  return Math.min(props.maxWidth, Math.max(props.minWidth, value));
}

function readStoredWidth(): number {
  const raw = localStorage.getItem(props.storageKey);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clamp(parsed) : props.defaultWidth;
}

const width = ref(readStoredWidth());
const dragging = ref(false);

// Live signal every frame; persistence waits for the gesture to settle so we
// don't hammer localStorage on every pointer move.
watch(width, (value) => emit("resize", value));

function persist() {
  localStorage.setItem(props.storageKey, String(Math.round(width.value)));
}

let startX = 0;
let startWidth = 0;

function toDelta(pointerDelta: number): number {
  // A left panel grows when the divider moves right; a right panel grows when it
  // moves left — so the sign flips by side.
  return props.side === "left" ? pointerDelta : -pointerDelta;
}

function onPointerMove(event: PointerEvent) {
  width.value = clamp(startWidth + toDelta(event.clientX - startX));
}

function onPointerUp() {
  dragging.value = false;
  persist();
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function onPointerDown(event: PointerEvent) {
  dragging.value = true;
  startX = event.clientX;
  startWidth = width.value;
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onKeydown(event: KeyboardEvent) {
  const step = (event.shiftKey ? 32 : 8) * (props.side === "left" ? 1 : -1);
  if (event.key === "ArrowRight") {
    event.preventDefault();
    width.value = clamp(width.value + step);
    persist();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    width.value = clamp(width.value - step);
    persist();
  }
}

function reset() {
  width.value = props.defaultWidth;
  persist();
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});

defineExpose({ reset });

const panelStyle = computed(() => ({ width: `${width.value}px` }));
</script>

<template>
  <div
    v-show="!collapsed"
    class="relative h-full shrink-0"
    :class="props.side === 'left' ? 'border-r border-hair' : 'border-l border-hair'"
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
      @pointerdown="onPointerDown"
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
