<script setup lang="ts">
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import type { MenuItemModel } from "./menu-shared.js";
import {
  menuContentClass,
  menuIconClass,
  menuItemClass,
  menuItemDangerClass,
  menuLabelClass,
  menuSeparatorClass,
  menuShortcutClass,
} from "./menu-shared.js";

// Data-driven dropdown (menu bars, action menus). The trigger goes in the
// `trigger` slot; items are declarative. `select` fires for actionable rows;
// checkboxes emit `toggle` and stay controlled by the parent.
const props = withDefaults(
  defineProps<{
    items: MenuItemModel[];
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
  }>(),
  { align: "start", side: "bottom" },
);

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string, checked: boolean];
}>();

const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="props.align"
        :side="props.side"
        :side-offset="6"
        :class="menuContentClass"
      >
        <template v-for="item in props.items" :key="item.id">
          <DropdownMenuSeparator
            v-if="item.kind === 'separator'"
            :class="menuSeparatorClass"
          />
          <DropdownMenuLabel
            v-else-if="item.kind === 'label'"
            :class="menuLabelClass"
          >
            {{ item.label }}
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            v-else-if="item.kind === 'checkbox'"
            :model-value="item.checked ?? false"
            :disabled="item.disabled ?? false"
            :class="menuItemClass"
            @update:model-value="(value) => emit('toggle', item.id, value)"
            @select="(event) => event.preventDefault()"
          >
            <span class="grid size-4 shrink-0 place-items-center text-gold">
              <svg
                v-if="item.checked"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.shortcut" :class="menuShortcutClass">
              {{ item.shortcut }}
            </span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem
            v-else
            :disabled="item.disabled ?? false"
            :class="[menuItemClass, item.danger ? menuItemDangerClass : '']"
            @select="emit('select', item.id)"
          >
            <component :is="item.icon" v-if="item.icon" :class="menuIconClass" />
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.shortcut" :class="menuShortcutClass">
              {{ item.shortcut }}
            </span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
