<script setup lang="ts">
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
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

// Right-click menu. The target is the default slot; items share the DropdownMenu
// model so the two menu surfaces look and behave identically.
const props = defineProps<{
  items: MenuItemModel[];
}>();

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string, checked: boolean];
}>();
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent :class="menuContentClass">
        <template v-for="item in props.items" :key="item.id">
          <ContextMenuSeparator
            v-if="item.kind === 'separator'"
            :class="menuSeparatorClass"
          />
          <ContextMenuLabel
            v-else-if="item.kind === 'label'"
            :class="menuLabelClass"
          >
            {{ item.label }}
          </ContextMenuLabel>
          <ContextMenuCheckboxItem
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
          </ContextMenuCheckboxItem>
          <ContextMenuItem
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
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
