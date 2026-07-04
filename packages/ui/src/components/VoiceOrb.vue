<script setup lang="ts">
// The Jarvis presence — one orb, six states. Pure CSS (no canvas/WebGL) so it
// runs identically in the web view and the future transparent Tauri overlay
// window. Gold IS the assistant (tokens.css contract); muted drains the color.
export type VoiceOrbState =
  "idle" | "wake" | "listening" | "thinking" | "speaking" | "muted";

const props = withDefaults(
  defineProps<{
    state?: VoiceOrbState | undefined;
    size?: number | undefined;
  }>(),
  { state: "idle", size: 160 },
);
</script>

<template>
  <div
    class="voice-orb"
    :class="`is-${props.state}`"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
    role="status"
    :aria-label="`voice ${props.state}`"
  >
    <span class="halo" aria-hidden="true" />
    <span class="core" aria-hidden="true" />
    <span class="ring" aria-hidden="true" />
  </div>
</template>

<style scoped>
.voice-orb {
  position: relative;
  display: grid;
  place-items: center;
}

.core {
  position: absolute;
  inset: 18%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 38% 32%,
    var(--gold-bright) 0%,
    var(--gold) 42%,
    rgba(120, 84, 25, 0.9) 100%
  );
  box-shadow: 0 0 40px var(--gold-soft);
  transition: filter var(--t-slow) var(--ease-out);
}

.halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, var(--gold-soft) 0%, transparent 68%);
}

.ring {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  border: 1.5px solid var(--gold-soft);
}

/* idle — barely breathing */
.is-idle .core {
  animation: orb-breathe 5s var(--ease-out) infinite;
}

/* wake — a quick recognition pop */
.is-wake .core {
  animation: orb-wake 0.5s var(--ease-out);
}

.is-wake .ring {
  animation: orb-ring-pop 0.6s var(--ease-out);
}

/* listening — steady attentive pulse */
.is-listening .core {
  animation: orb-breathe 1.8s var(--ease-out) infinite;
}

.is-listening .ring {
  animation: orb-ring-pop 1.8s var(--ease-out) infinite;
}

/* thinking — the ring orbits */
.is-thinking .ring {
  border-color: transparent;
  border-top-color: var(--gold);
  animation: orb-spin 1.1s linear infinite;
}

.is-thinking .core {
  filter: saturate(0.8) brightness(0.92);
}

/* speaking — talking amplitude */
.is-speaking .core {
  animation: orb-speak 0.42s ease-in-out infinite alternate;
}

.is-speaking .halo {
  animation: orb-breathe 0.84s ease-in-out infinite;
}

/* muted — drained, still present */
.is-muted .core {
  filter: grayscale(0.85) brightness(0.6);
}

.is-muted .halo,
.is-muted .ring {
  opacity: 0.25;
}

@keyframes orb-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

@keyframes orb-wake {
  0% {
    transform: scale(0.92);
  }
  55% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes orb-ring-pop {
  0% {
    transform: scale(0.96);
    opacity: 1;
  }
  100% {
    transform: scale(1.22);
    opacity: 0;
  }
}

@keyframes orb-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes orb-speak {
  from {
    transform: scale(0.97);
  }
  to {
    transform: scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .voice-orb .core,
  .voice-orb .ring,
  .voice-orb .halo {
    animation: none;
  }
}
</style>
