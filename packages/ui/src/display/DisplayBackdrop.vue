<script setup lang="ts">
// The room's moving ground. Four stacked layers, all of them decorative and
// none of them interactive:
//
//   wash    a large gradient that slides and rotates under everything
//   aurora  three blurred colour blobs on long, prime-ish loops so they never
//           resync into a visible beat
//   stars   three parallax fields, drifting at different speeds + twinkling
//   sheen   one bright sweep crossing the room
//
// Every layer is painted from CSS variables, so a theme decides its colours,
// how bright it burns, and which layers it uses at all — see
// `display-themes.css`. A theme that wants no stars sets `--bd-stars-opacity:
// 0` rather than needing its own markup.
//
// Animation is `transform` and `opacity` ONLY — both composited, so the whole
// backdrop stays off the main thread however loud it looks. The star fields
// are gradient-painted (not thousands of DOM nodes) for the same reason: this
// runs behind a live voice session and must not cost it frames.
</script>

<template>
  <div
    class="display-backdrop"
    aria-hidden="true"
    data-testid="display-backdrop"
  >
    <span class="bd-wash" />
    <!-- Six blobs, not three. Three read as a slow gradient; six overlapping
         at different sizes and speeds read as liquid, which is what this has
         to look like on camera. They are cheap — one blurred radial each,
         composited on the GPU. -->
    <span class="bd-aurora a" />
    <span class="bd-aurora b" />
    <span class="bd-aurora c" />
    <span class="bd-aurora d" />
    <span class="bd-aurora e" />
    <span class="bd-aurora f" />
    <span class="bd-stars s1" />
    <span class="bd-stars s2" />
    <span class="bd-stars s3" />
    <!-- The grid. Above the colour so it is not buried by it, below the
         vignette so the corners still take it. -->
    <span class="bd-grid" />
    <span class="bd-sheen" />
    <!-- The frame goes dark at its EDGES, clear through the middle. Every
         reference for this room is a hot subject on black corners, and that
         falloff is what makes the subject read across a wall of monitors: the
         eye is pulled to the brightest thing in a dark frame.

         Darkening the CENTRE instead — which is what this layer did first —
         puts a grey disc directly behind the subject and dims the one thing
         that is supposed to burn. Exactly backwards. -->
    <span class="bd-vignette" />
    <!-- The black hole. OFF by default and switched on by the shapes that have
         a hole in them (Ribbon, Aperture), where the interior should read as
         genuine black rather than as haze showing the ground through. On a
         solid shape it would sit on top of the bright centre and kill it,
         which is why it is per-shape and not global. -->
    <span class="bd-core-shade" />
    <!-- Last layer, over all the colour: the floor the text stands on. Without
         it a bright wash drifting under a semi-transparent panel takes the
         readouts with it, and the room is only useful if you can still read
         it while it moves. Each theme sets how much it needs. -->
    <span class="bd-scrim" />
  </div>
</template>

<style scoped>
.display-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  /* Isolate so the blend modes below cannot reach the app behind the room. */
  isolation: isolate;
}

.display-backdrop > * {
  position: absolute;
  display: block;
  pointer-events: none;
}

/* --- wash: the big slow gradient under everything ------------------------ */
.bd-wash {
  /* Oversized and rotated, so the corners never show an edge as it moves. */
  inset: -40%;
  background: conic-gradient(
    from 0deg at 50% 50%,
    var(--bd-1, #1e78d2),
    var(--bd-2, #7b3ff2),
    var(--bd-3, #17b8c4),
    var(--bd-1, #1e78d2)
  );
  opacity: var(--bd-wash-opacity, 0.72);
  filter: blur(var(--bd-wash-blur, 64px)) saturate(var(--bd-saturate, 2));
  animation: bd-spin var(--bd-wash-speed, 13s) linear infinite;
  will-change: transform;
}

/* --- aurora: three blobs on unequal loops -------------------------------- */
.bd-aurora {
  width: 74%;
  height: 74%;
  border-radius: 50%;
  filter: blur(var(--bd-aurora-blur, 72px)) saturate(var(--bd-saturate, 2));
  opacity: var(--bd-aurora-opacity, 0.92);
  mix-blend-mode: var(--bd-blend, screen);
  will-change: transform;
}

/* Six blobs on six unequal, deliberately prime-ish loops. Equal or harmonically
 * related durations would resync into a visible pulse every few seconds — the
 * one thing that makes a background read as a loop rather than as motion. */
.bd-aurora.a {
  top: -16%;
  left: -12%;
  background: radial-gradient(circle, var(--bd-1, #1e78d2), transparent 68%);
  animation: bd-drift-a var(--bd-aurora-speed-a, 7s) ease-in-out infinite;
}

.bd-aurora.b {
  bottom: -20%;
  right: -14%;
  background: radial-gradient(circle, var(--bd-2, #7b3ff2), transparent 68%);
  animation: bd-drift-b var(--bd-aurora-speed-b, 9s) ease-in-out infinite;
}

.bd-aurora.c {
  top: 18%;
  left: 32%;
  background: radial-gradient(circle, var(--bd-3, #17b8c4), transparent 68%);
  animation: bd-drift-c var(--bd-aurora-speed-c, 11s) ease-in-out infinite;
}

.bd-aurora.d {
  bottom: -12%;
  left: 6%;
  width: 58%;
  height: 58%;
  background: radial-gradient(circle, var(--bd-2, #7b3ff2), transparent 66%);
  animation: bd-drift-b var(--bd-aurora-speed-d, 13s) ease-in-out infinite
    reverse;
}

.bd-aurora.e {
  top: -10%;
  right: 4%;
  width: 64%;
  height: 64%;
  background: radial-gradient(circle, var(--bd-3, #17b8c4), transparent 66%);
  animation: bd-drift-c var(--bd-aurora-speed-e, 8.5s) ease-in-out infinite
    reverse;
}

.bd-aurora.f {
  top: 34%;
  right: 22%;
  width: 50%;
  height: 50%;
  background: radial-gradient(circle, var(--bd-1, #1e78d2), transparent 64%);
  animation: bd-drift-a var(--bd-aurora-speed-f, 10.5s) ease-in-out infinite
    reverse;
}

/* --- stars: three parallax fields ---------------------------------------- */
/* Painted as repeating radial-gradient dots. The element is 200% tall and
 * translates by exactly -50%, so the loop is seamless. */
.bd-stars {
  inset: 0;
  height: 200%;
  opacity: var(--bd-stars-opacity, 0.9);
  will-change: transform;
}

.bd-stars.s1 {
  background-image:
    radial-gradient(
      3.2px 3.2px at 12% 8%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      2.6px 2.6px at 72% 18%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      3.6px 3.6px at 38% 32%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      2.4px 2.4px at 88% 44%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      3.2px 3.2px at 24% 58%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      2.6px 2.6px at 62% 71%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      3.4px 3.4px at 8% 84%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(
      2.8px 2.8px at 52% 94%,
      var(--bd-star, #fff),
      transparent 100%
    );
  background-size: 21% 17%;
  animation:
    bd-fall var(--bd-stars-speed-1, 26s) linear infinite,
    bd-twinkle 1.9s ease-in-out infinite;
}

.bd-stars.s2 {
  background-image:
    radial-gradient(
      4.6px 4.6px at 28% 14%,
      var(--bd-star, #fff),
      transparent 100%
    ),
    radial-gradient(4px 4px at 81% 36%, var(--bd-star, #fff), transparent 100%),
    radial-gradient(5px 5px at 46% 62%, var(--bd-star, #fff), transparent 100%),
    radial-gradient(
      4.2px 4.2px at 15% 78%,
      var(--bd-star, #fff),
      transparent 100%
    );
  background-size: 30% 25%;
  opacity: calc(var(--bd-stars-opacity, 0.9) * 0.8);
  animation:
    bd-fall var(--bd-stars-speed-2, 17s) linear infinite,
    bd-twinkle 2.7s ease-in-out infinite reverse;
}

/* The near field: fewer, bigger, with a glow — this is the one you notice. */
.bd-stars.s3 {
  background-image:
    radial-gradient(
      6.5px 6.5px at 66% 22%,
      var(--bd-star-bright, #fff),
      transparent 100%
    ),
    radial-gradient(
      5.8px 5.8px at 20% 48%,
      var(--bd-star-bright, #fff),
      transparent 100%
    ),
    radial-gradient(
      7px 7px at 84% 76%,
      var(--bd-star-bright, #fff),
      transparent 100%
    );
  background-size: 40% 34%;
  opacity: calc(var(--bd-stars-opacity, 0.9) * 0.95);
  filter: drop-shadow(0 0 9px var(--bd-star-glow, rgba(255, 255, 255, 0.9)))
    drop-shadow(0 0 22px var(--bd-star-glow, rgba(255, 255, 255, 0.55)));
  animation:
    bd-fall var(--bd-stars-speed-3, 11s) linear infinite,
    bd-twinkle 1.4s ease-in-out infinite;
}

/* --- grid: the technical floor under everything -------------------------- */
.bd-grid {
  inset: 0;
  background-image:
    linear-gradient(
      var(--bd-grid-line, rgba(120, 200, 255, 0.22)) 1.5px,
      transparent 1.5px
    ),
    linear-gradient(
      90deg,
      var(--bd-grid-line, rgba(120, 200, 255, 0.22)) 1.5px,
      transparent 1.5px
    );
  background-size: var(--bd-grid-size, 64px) var(--bd-grid-size, 64px);
  opacity: var(--bd-grid-opacity, 1);
  /* Solid across the middle, gone by the corners — the old mask started
   * fading at 20%, which cut the grid out of exactly the part of frame where
   * it is most visible. */
  mask-image: radial-gradient(ellipse at 50% 50%, #000 55%, transparent 97%);
  animation: bd-grid-drift var(--bd-grid-speed, 26s) linear infinite;
  will-change: transform;
}

@keyframes bd-grid-drift {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    /* Exactly one tile, so the drift is seamless. */
    transform: translate3d(
      calc(var(--bd-grid-size, 64px) * -1),
      calc(var(--bd-grid-size, 64px) * -1),
      0
    );
  }
}

/* --- sheen: one bright pass across the room ------------------------------ */
.bd-sheen {
  inset: -30%;
  background: linear-gradient(
    104deg,
    transparent 38%,
    var(--bd-sheen, rgba(255, 255, 255, 0.3)) 50%,
    transparent 62%
  );
  opacity: var(--bd-sheen-opacity, 1);
  animation: bd-sweep var(--bd-sheen-speed, 4.5s) ease-in-out infinite;
  will-change: transform;
}

/* --- core shade: the black hole, for shapes with a hollow middle --------- */
.bd-core-shade {
  inset: 0;
  opacity: var(--bd-core-shade-opacity, 0);
  /* closest-side, so 100% is half the SHORT side of the frame — the same
   * dimension the renderer sizes the object against. With the default
   * farthest-corner sizing these percentages were measured against the
   * diagonal instead, which on a wide monitor made the hole about 40% larger
   * than intended and swallowed Aperture blades. */
  background: radial-gradient(
    circle closest-side at 50% 50%,
    rgba(0, 0, 0, 0.97) 0%,
    rgba(0, 0, 0, 0.95) var(--bd-core-shade-solid, 20%),
    transparent var(--bd-core-shade-edge, 44%)
  );
}

/* --- vignette: black at the edges, clear in the middle ------------------- */
.bd-vignette {
  inset: 0;
  /* Clear through the centre third so nothing dims the subject, then falling
   * to near-black by the corners. Two stops rather than one so the falloff is
   * a gradient the eye reads as depth, not a visible ring. */
  background: radial-gradient(
    ellipse at 50% 50%,
    transparent 0%,
    transparent 34%,
    var(--bd-vignette-mid, rgba(0, 0, 0, 0.55)) 68%,
    var(--bd-vignette, rgba(0, 0, 0, 0.92)) 100%
  );
}

/* --- scrim: the legibility floor ----------------------------------------- */
.bd-scrim {
  inset: 0;
  background: var(--bd-scrim, rgba(2, 8, 20, 0.46));
}

@keyframes bd-spin {
  from {
    transform: rotate(0deg) scale(1.16);
  }
  to {
    transform: rotate(360deg) scale(1.16);
  }
}

@keyframes bd-drift-a {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(34%, 40%, 0) scale(1.55);
  }
}

@keyframes bd-drift-b {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1.3);
  }
  50% {
    transform: translate3d(-40%, -30%, 0) scale(0.72);
  }
}

@keyframes bd-drift-c {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(0.88);
  }
  33% {
    transform: translate3d(-32%, 34%, 0) scale(1.48);
  }
  66% {
    transform: translate3d(38%, -26%, 0) scale(1.18);
  }
}

/* Exactly -50% of a 200%-tall element: the field repeats with no seam. */
@keyframes bd-fall {
  from {
    transform: translate3d(0, -50%, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes bd-twinkle {
  0%,
  100% {
    opacity: var(--bd-stars-opacity, 0.9);
  }
  50% {
    opacity: calc(var(--bd-stars-opacity, 0.9) * 0.42);
  }
}

@keyframes bd-sweep {
  0%,
  100% {
    transform: translate3d(-54%, 0, 0) skewX(-8deg);
  }
  50% {
    transform: translate3d(54%, 0, 0) skewX(-8deg);
  }
}

/* Motion is the point of this layer, so reduced-motion keeps the COLOUR and
 * drops only the movement — a still gradient, not a blank room. */
@media (prefers-reduced-motion: reduce) {
  .bd-wash,
  .bd-aurora,
  .bd-stars,
  .bd-sheen {
    animation: none !important;
  }

  .bd-stars {
    transform: translate3d(0, -25%, 0);
  }
}
</style>
