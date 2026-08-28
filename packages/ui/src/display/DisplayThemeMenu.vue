<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { DISPLAY_SHAPES, resolveDisplayShape } from "./display-shapes.js";
import { DISPLAY_COLOURS, resolveDisplayColour } from "./display-colours.js";

// The Display's picker: TWO axes, not one list.
//
// Shape and colour are chosen separately on purpose. A single roster of every
// pairing would be ten shapes × nine colours = ninety rows that are really
// nineteen things, and picking "the ribbon, but red" would mean hunting for
// whichever row someone happened to name that. Two short lists say what they
// are.
//
// Presentational only: which panel is open is all this owns. The selections
// and where they persist belong to the host.
const props = defineProps<{ shape: string; colour: string }>();
const emit = defineEmits<{
  (event: "update:shape", id: string): void;
  (event: "update:colour", id: string): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const activeShape = computed(() => resolveDisplayShape(props.shape));
const activeColour = computed(() => resolveDisplayColour(props.colour));

// The shape panel closes on pick — you chose the room and want to see it. The
// colour panel does NOT: recolouring is something you do by eye, trying three
// in a row against the same shape, and a menu that shuts each time makes that
// six clicks instead of three.
function chooseShape(id: string): void {
  emit("update:shape", id);
  open.value = false;
}

function chooseColour(id: string): void {
  emit("update:colour", id);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && root.value?.contains(target) === true) return;
  open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="theme-menu">
    <button
      type="button"
      class="theme-trigger"
      :class="{ on: open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      data-testid="display-theme-trigger"
      @click="open = !open"
    >
      <span class="theme-name">{{ activeShape.label }}</span>
      <span class="theme-sep" aria-hidden="true">·</span>
      <span class="theme-name dim">{{ activeColour.label }}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="theme-panel" data-testid="display-theme-panel">
      <p class="group-title">Shape</p>
      <div role="menu" aria-label="Shape">
        <button
          v-for="shape in DISPLAY_SHAPES"
          :key="shape.id"
          type="button"
          role="menuitemradio"
          class="theme-option"
          :class="{ selected: shape.id === activeShape.id }"
          :aria-checked="shape.id === activeShape.id"
          :data-testid="`display-shape-option-${shape.id}`"
          @click="chooseShape(shape.id)"
        >
          <span class="option-text">
            <span class="option-label">{{ shape.label }}</span>
            <span class="option-note">{{ shape.note }}</span>
          </span>
        </button>
      </div>

      <p class="group-title">Colour</p>
      <!-- A swatch grid, not a list: colour is the one thing you can judge
           without reading, so the names are titles rather than rows. -->
      <div class="swatches" role="menu" aria-label="Colour">
        <button
          v-for="colour in DISPLAY_COLOURS"
          :key="colour.id"
          type="button"
          role="menuitemradio"
          class="swatch display-palette"
          :class="{ selected: colour.id === activeColour.id }"
          :aria-checked="colour.id === activeColour.id"
          :aria-label="colour.label"
          :title="colour.label"
          :data-display-colour="colour.id"
          :data-testid="`display-colour-option-${colour.id}`"
          @click="chooseColour(colour.id)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-menu {
  position: relative;
  display: inline-flex;
}

.theme-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: transparent;
  padding: 3px 9px;
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease;
}

.theme-trigger:hover,
.theme-trigger.on {
  border-color: var(--display-accent, #4fd8ff);
  color: var(--display-text, #cdf3ff);
}

.theme-name.dim {
  opacity: 0.7;
}

.theme-sep {
  opacity: 0.5;
}

.chev {
  font-size: 8px;
  opacity: 0.8;
}

.theme-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 266px;
  max-height: 78vh;
  overflow-y: auto;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: var(--display-ground-bottom, #010a1c);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.6);
}

.group-title {
  margin: 0;
  padding: 7px 10px 5px;
  font-size: 9px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  border-bottom: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
}

.theme-option {
  display: flex;
  width: 100%;
  align-items: flex-start;
  border: 0;
  border-bottom: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: transparent;
  padding: 7px 10px;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.theme-option:hover {
  background: rgba(255, 255, 255, 0.05);
}

.theme-option.selected {
  background: rgba(255, 255, 255, 0.08);
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-label {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--display-text, #cdf3ff);
}

/* The note says what the shape IS — never what colour it is, because colour
   is the other axis. */
.option-note {
  font-size: 9px;
  letter-spacing: 0.04em;
  line-height: 1.4;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  padding: 9px 10px 11px;
}

/* Each swatch paints itself from its OWN colour block, so the grid is a live
   preview of the palettes rather than a second copy of them. */
.swatch {
  height: 26px;
  border: 1px solid var(--display-accent-faint, rgba(255, 255, 255, 0.14));
  border-radius: 3px;
  cursor: pointer;
  background:
    radial-gradient(
      circle at 34% 32%,
      var(--display-accent, #4fd8ff),
      transparent 62%
    ),
    linear-gradient(
      140deg,
      var(--display-ground-top, #02132b),
      var(--display-ground-bottom, #010a1c)
    );
  transition:
    transform 110ms ease,
    border-color 110ms ease;
}

.swatch:hover {
  transform: translateY(-1px);
  border-color: var(--display-accent, #4fd8ff);
}

.swatch.selected {
  border-color: var(--display-text, #cdf3ff);
  box-shadow: inset 0 0 0 1px var(--display-text, #cdf3ff);
}
</style>

<!-- The shape and colour blocks. Loaded here because the menu is always
     mounted, so the swatches have palettes to paint from. -->
<style src="./display-themes.css"></style>
