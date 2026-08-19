<script setup lang="ts">
import { onUnmounted, watch } from "vue";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from "reka-ui";
import { reportModalOpenChange } from "./modal-registry.js";

// One accessible modal base (focus-trap, Esc, scroll-lock, backdrop — all from
// Reka's Dialog). Replaces the per-dialog Teleport/backdrop copy-paste. Body is
// the default slot; actions go in the `footer` slot.
const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    size?: "sm" | "md" | "lg" | "xl";
    hideClose?: boolean;
  }>(),
  { size: "md", hideClose: false },
);

const open = defineModel<boolean>("open", { required: true });

// Every open/close reports to the shared registry (see modal-registry.ts) —
// a mounted-open modal counts too, and unmounting while open balances out.
if (open.value) reportModalOpenChange(true);
watch(open, (isOpen, wasOpen) => {
  if (isOpen !== wasOpen) reportModalOpenChange(isOpen);
});
onUnmounted(() => {
  if (open.value) reportModalOpenChange(false);
});

const sizeClass: Record<NonNullable<typeof props.size>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-3xl",
};

// Reka's focus scope moves focus to the first tabbable element on open, which
// ignores native `autofocus`. Honor it so a dialog's marked field (a search
// box, the first input) gets the caret instead of whatever happens to be first.
function onOpenAutoFocus(event: Event) {
  const marked = (event.target as HTMLElement | null)?.querySelector<HTMLElement>(
    "[autofocus]",
  );
  if (marked) {
    event.preventDefault();
    marked.focus();
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay animate-overlay-in" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-hair-strong bg-raised text-ink-1 shadow-overlay outline-none animate-pop-in',
          sizeClass[props.size],
        ]"
        @open-auto-focus="onOpenAutoFocus"
      >
        <header
          v-if="props.title || props.description || $slots.title"
          class="px-4 pb-2 pt-4"
        >
          <DialogTitle class="m-0 text-lg font-semibold text-ink-1">
            <slot name="title">{{ props.title }}</slot>
          </DialogTitle>
          <DialogDescription
            v-if="props.description"
            class="mt-1 text-sm text-ink-2"
          >
            {{ props.description }}
          </DialogDescription>
        </header>
        <VisuallyHidden v-else as-child>
          <DialogTitle>{{ props.title ?? "Dialog" }}</DialogTitle>
        </VisuallyHidden>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-1">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex justify-end gap-2 px-4 pb-4 pt-3"
        >
          <slot name="footer" />
        </footer>

        <DialogClose
          v-if="!props.hideClose"
          aria-label="Close"
          class="absolute right-3 top-3 grid size-7 place-items-center rounded-sm text-ink-3 outline-none transition hover:bg-row-hover hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-gold"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
