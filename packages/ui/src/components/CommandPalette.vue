<script lang="ts">
import type { Component } from "vue";

export interface CommandItem {
  id: string;
  label: string;
  /** Secondary text (also searched). */
  hint?: string;
  /** Group heading this command sorts under. */
  group?: string;
  /** A Vue component (e.g. a lucide icon). */
  icon?: Component;
  /** Right-aligned shortcut hint. */
  shortcut?: string;
  /** Extra search terms, not shown. */
  keywords?: string;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from "reka-ui";

// ⌘K palette. Reka's Dialog owns the modal shell (focus-trap, Esc, overlay); the
// combobox behavior (filter + roving highlight + Enter) is hand-rolled for full
// control. Data-blind: commands in, `select` out.
const props = withDefaults(
  defineProps<{
    commands: CommandItem[];
    placeholder?: string;
    emptyText?: string;
  }>(),
  { placeholder: "Type a command or search…", emptyText: "No matches." },
);

const emit = defineEmits<{
  select: [id: string];
}>();

const open = defineModel<boolean>("open", { required: true });

const query = ref("");
const activeIndex = ref(0);
const listElement = ref<HTMLElement | null>(null);

function matches(command: CommandItem, term: string): boolean {
  const haystack =
    `${command.label} ${command.hint ?? ""} ${command.group ?? ""} ${command.keywords ?? ""}`.toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

const results = computed(() => {
  const term = query.value.trim();
  if (!term) return props.commands;
  return props.commands.filter((command) => matches(command, term));
});

type RenderRow =
  | { type: "label"; key: string; group: string }
  | { type: "item"; key: string; command: CommandItem; index: number };

const renderRows = computed<RenderRow[]>(() => {
  const rows: RenderRow[] = [];
  let lastGroup: string | undefined;
  results.value.forEach((command, index) => {
    if (command.group && command.group !== lastGroup) {
      rows.push({ type: "label", key: `group:${command.group}`, group: command.group });
      lastGroup = command.group;
    }
    rows.push({ type: "item", key: command.id, command, index });
  });
  return rows;
});

// Keep the highlight valid as the list shrinks; reset to the top on new input.
watch(results, () => {
  activeIndex.value = 0;
});

watch(open, (isOpen) => {
  if (!isOpen) {
    query.value = "";
    activeIndex.value = 0;
  }
});

watch(activeIndex, async () => {
  await nextTick();
  listElement.value
    ?.querySelector(`[data-index="${activeIndex.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
});

const activeDescendant = computed(() =>
  results.value.length > 0 ? `command-option-${activeIndex.value}` : undefined,
);

function move(delta: number) {
  const count = results.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
}

function choose(index: number) {
  const command = results.value[index];
  if (!command) return;
  emit("select", command.id);
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(activeIndex.value);
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay animate-overlay-in" />
      <DialogContent
        class="fixed left-1/2 top-[18%] z-50 flex max-h-[64vh] w-[92vw] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-hair-strong bg-raised text-ink-1 shadow-overlay outline-none animate-pop-in"
      >
        <VisuallyHidden as-child>
          <DialogTitle>Command palette</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden as-child>
          <DialogDescription>Search commands and jump anywhere.</DialogDescription>
        </VisuallyHidden>

        <div class="flex items-center gap-2.5 border-b border-hair px-3.5">
          <svg
            class="size-4 shrink-0 text-ink-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            v-model="query"
            type="text"
            autofocus
            role="combobox"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            :aria-expanded="true"
            :aria-activedescendant="activeDescendant"
            :placeholder="props.placeholder"
            class="w-full bg-transparent py-3 text-base text-ink-1 outline-none placeholder:text-ink-3"
            @keydown="onKeydown"
          />
        </div>

        <div
          id="command-palette-list"
          ref="listElement"
          role="listbox"
          class="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          <p
            v-if="results.length === 0"
            class="select-none px-3 py-6 text-center text-sm text-ink-2"
          >
            {{ props.emptyText }}
          </p>
          <template v-for="row in renderRows" :key="row.key">
            <p
              v-if="row.type === 'label'"
              class="select-none px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-ink-2"
            >
              {{ row.group }}
            </p>
            <button
              v-else
              :id="`command-option-${row.index}`"
              type="button"
              role="option"
              :data-index="row.index"
              :aria-selected="row.index === activeIndex"
              class="flex w-full cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-base outline-none transition"
              :class="
                row.index === activeIndex
                  ? 'bg-row-hover text-ink-1'
                  : 'text-ink-2'
              "
              @mousemove="activeIndex = row.index"
              @click="choose(row.index)"
            >
              <component
                :is="row.command.icon"
                v-if="row.command.icon"
                class="size-4 shrink-0 text-ink-2"
              />
              <span class="flex-1 truncate text-ink-1">{{ row.command.label }}</span>
              <span v-if="row.command.hint" class="truncate text-xs text-ink-2">
                {{ row.command.hint }}
              </span>
              <span
                v-if="row.command.shortcut"
                class="ml-1 text-2xs tabular-nums tracking-wider text-ink-3"
              >
                {{ row.command.shortcut }}
              </span>
            </button>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
