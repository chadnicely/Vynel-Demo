<script setup lang="ts">
// A choice chip — the wizard's one way to pick from a short list (audience,
// sign-in, where it lives, the stack options, the 1–10 score). `on` is the
// picked look; everything else is the same quiet pill.
defineProps<{ on: boolean; small?: boolean }>();
</script>

<template>
  <button
    type="button"
    class="cursor-default rounded-full border transition"
    :class="[
      small ? 'px-2.5 py-0.5 text-[11.5px]' : 'px-3 py-1 text-[12.5px]',
      on
        ? 'border-gold bg-gold-soft text-ink-1'
        : 'border-hair-strong bg-panel text-ink-2 hover:bg-row-hover hover:text-ink-1',
    ]"
    :aria-pressed="on"
  >
    <slot />
  </button>
</template>
