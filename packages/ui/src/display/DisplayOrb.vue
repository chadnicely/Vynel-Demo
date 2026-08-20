<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { createOrbRenderer } from "./orb-renderer.js";
import type { OrbRenderer } from "./orb-renderer.js";

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
}>();

// A canvas-less environment must not take the whole Display down: the orb is
// presence, the panels carry the actual status. The owner decides whether a
// blank stage is worth telling the user about — this primitive has no logger.
const emit = defineEmits<{ (event: "renderer-failed", error: unknown): void }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let renderer: OrbRenderer | null = null;

onMounted(() => {
  const element = canvas.value;
  if (!element) return;
  try {
    renderer = createOrbRenderer(element);
  } catch (error) {
    emit("renderer-failed", error);
    return;
  }
  renderer.setEnergy(props.energy);
  renderer.setListening(props.listening);
  renderer.setSpeaking(props.speaking);
});

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
