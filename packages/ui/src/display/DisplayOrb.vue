<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { createOrbRenderer } from "./orb-renderer.js";
import type { OrbRenderer } from "./orb-renderer.js";
import type { OrbPalette } from "./orb-palette.js";
import type { OrbForm } from "./orb-forms.js";

// The Display's presence. All of its motion comes from the props — the orb
// never invents activity, so what you see is what the assistant is doing.
const props = defineProps<{
  /** How busy the assistant is, 0..1. */
  energy: number;
  /** The microphone is open. */
  listening: boolean;
  /** The assistant is talking. */
  speaking: boolean;
  /** Bump this to throw one shockwave — one per spoken clause. */
  spikeKey?: number | undefined;
  /** The theme's canvas paint set. Omitted = the cyan default. The renderer
   *  bakes its mote sprites from this at construction, so a change rebuilds
   *  the renderer rather than mutating one — see the watcher below. */
  palette?: OrbPalette | undefined;
  /** Which shape the cloud takes — sphere, ribbon or flare. Baked into the
   *  mote field at construction like the palette, so a change rebuilds. */
  form?: OrbForm | undefined;
}>();

// A canvas-less environment must not take the whole Display down: the orb is
// presence, the panels carry the actual status. The owner decides whether a
// blank stage is worth telling the user about — this primitive has no logger.
const emit = defineEmits<{
  (event: "renderer-failed", error: unknown): void;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
let renderer: OrbRenderer | null = null;

/** Build (or rebuild) the renderer against the current palette and hand it the
 *  live state, so a theme switch never shows a default-cyan frame first. */
function mountRenderer(): void {
  const element = canvas.value;
  if (!element) return;
  renderer?.stop();
  renderer = null;
  try {
    renderer = createOrbRenderer(element, {
      ...(props.palette === undefined ? {} : { palette: props.palette }),
      ...(props.form === undefined ? {} : { form: props.form }),
    });
  } catch (error) {
    emit("renderer-failed", error);
    return;
  }
  renderer.setEnergy(props.energy);
  renderer.setListening(props.listening);
  renderer.setSpeaking(props.speaking);
}

onMounted(mountRenderer);

// The sprites are baked once from the palette and the field once from the
// form, so changing either needs a NEW renderer — restyling in place would
// keep the old tints, and reshaping in place would keep the old geometry.
watch(
  () => [props.palette, props.form],
  () => mountRenderer(),
);

watch(
  () => props.energy,
  (value) => renderer?.setEnergy(value),
);
watch(
  () => props.listening,
  (value) => renderer?.setListening(value),
);
watch(
  () => props.speaking,
  (value) => renderer?.setSpeaking(value),
);
// No `immediate`: the first render is not a spoken clause.
watch(
  () => props.spikeKey,
  () => renderer?.spike(),
);

onUnmounted(() => {
  renderer?.stop();
  renderer = null;
});
</script>

<template>
  <canvas ref="canvas" class="display-orb" aria-hidden="true" />
</template>

<style src="./display-root.css"></style>

<style scoped>
/* The renderer measures this box through a ResizeObserver, so the canvas can
 * be laid out by the host any way it likes. */
.display-orb {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
