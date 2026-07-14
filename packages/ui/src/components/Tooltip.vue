<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";

// A hover/focus tooltip for icon-only controls — the app's first real tooltip
// (native `title` was all we had). The trigger is the default slot; wrap a
// single focusable element. Self-contained: no app-level provider required.
const props = withDefaults(
  defineProps<{
    label: string;
    side?: "top" | "right" | "bottom" | "left";
    delayMs?: number;
    disabled?: boolean;
  }>(),
  { side: "top", delayMs: 400, disabled: false },
);
</script>

<template>
  <slot v-if="props.disabled" />
  <TooltipProvider v-else :delay-duration="props.delayMs" :skip-delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="props.side"
          :side-offset="6"
          class="z-50 max-w-xs select-none rounded-sm border border-hair bg-raised px-2 py-1 text-xs text-ink-1 shadow-overlay animate-pop-in"
        >
          {{ props.label }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
