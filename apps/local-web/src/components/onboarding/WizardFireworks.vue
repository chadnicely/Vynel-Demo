<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

// The finish-line celebration (Chad, 2026-08-24) — behind the card.
//
// This is a CANVAS particle system, not CSS, because CSS cannot do the thing
// that makes a firework read as a firework: the TRAIL. Every good
// implementation gets streaks by NOT clearing the canvas each frame — it
// erases only a little alpha, so each particle's previous positions smear
// behind it. A CSS spark can only ever be a dot with a glow.
//
// The rest of the difference is per-frame physics — gravity, drag, flicker,
// shrink — and a rocket that rises before it bursts.
//
// Lifecycle is the thing to get right with a rAF loop: ONE teardown cancels
// the frame and removes the resize listener, and reduced-motion never starts
// the loop at all. Decoration only, so the canvas is aria-hidden.

const canvas = ref<HTMLCanvasElement | null>(null);

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  hue: number;
  size: number;
};

type Rocket = {
  x: number;
  y: number;
  vy: number;
  targetY: number;
  hue: number;
};

const GRAVITY = 0.055;
const DRAG = 0.988;
// Vynel's accent sits around 260deg; the warm golds around 40. Bursts pick
// from these so the celebration still looks like this product.
const HUES = [262, 258, 44, 38, 280, 50];

let teardown: (() => void) | null = null;

onMounted(() => {
  const element = canvas.value;
  if (!element) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const context = element.getContext("2d");
  if (!context) return;

  let width = 0;
  let height = 0;
  let frame = 0;
  let stopped = false;

  function resize() {
    if (!element || !context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = element.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    element.width = Math.floor(width * ratio);
    element.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);

  const particles: Particle[] = [];
  const rockets: Rocket[] = [];
  let sinceLaunch = 0;

  function launch() {
    const hue = HUES[Math.floor(Math.random() * HUES.length)] ?? 262;
    rockets.push({
      x: width * (0.15 + Math.random() * 0.7),
      y: height,
      vy: -(height * 0.014 + Math.random() * 2.2),
      targetY: height * (0.14 + Math.random() * 0.3),
      hue,
    });
  }

  function burst(x: number, y: number, hue: number) {
    const count = 90 + Math.floor(Math.random() * 50);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      // sqrt keeps the burst filled rather than a hollow ring.
      const speed = Math.sqrt(Math.random()) * 5.6 + 0.6;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.008 + Math.random() * 0.011,
        hue: hue + (Math.random() * 24 - 12),
        size: 1.1 + Math.random() * 1.6,
      });
    }
  }

  function tick() {
    if (stopped || !context) return;

    // THE trail: erase a little alpha instead of clearing, so what was drawn
    // last frame stays as a fading streak.
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0, 0, 0, 0.16)";
    context.fillRect(0, 0, width, height);

    // Additive so overlapping sparks glow rather than muddy.
    context.globalCompositeOperation = "lighter";

    sinceLaunch += 1;
    if (sinceLaunch > 26 && rockets.length < 3) {
      sinceLaunch = 0;
      launch();
    }

    for (let index = rockets.length - 1; index >= 0; index -= 1) {
      const rocket = rockets[index]!;
      rocket.y += rocket.vy;
      rocket.vy += GRAVITY * 1.6;

      context.beginPath();
      context.arc(rocket.x, rocket.y, 1.8, 0, Math.PI * 2);
      context.fillStyle = `hsl(${rocket.hue} 100% 72%)`;
      context.fill();

      if (rocket.y <= rocket.targetY || rocket.vy >= 0) {
        burst(rocket.x, rocket.y, rocket.hue);
        rockets.splice(index, 1);
      }
    }

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index]!;
      particle.vx *= DRAG;
      particle.vy *= DRAG;
      particle.vy += GRAVITY;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life -= particle.decay;

      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }

      // Flicker: real embers pulse as they tumble.
      const flicker = 0.75 + Math.random() * 0.25;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fillStyle = `hsl(${particle.hue} 100% ${58 + particle.life * 26}% / ${particle.life * flicker})`;
      context.fill();
    }

    frame = requestAnimationFrame(tick);
  }

  // Open on a burst rather than making the user wait for the first rocket.
  burst(width * 0.5, height * 0.32, 262);
  launch();
  frame = requestAnimationFrame(tick);

  teardown = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
});

onBeforeUnmount(() => {
  teardown?.();
  teardown = null;
});
</script>

<template>
  <canvas ref="canvas" class="fireworks" aria-hidden="true" />
</template>

<style scoped>
.fireworks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
