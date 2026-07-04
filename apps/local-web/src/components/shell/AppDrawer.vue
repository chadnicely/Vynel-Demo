<script setup lang="ts">
import { X } from "lucide-vue-next";
import { IconButton } from "@vynel/ui";

// The "hidden menu" — a slide-over panel anchored to the left column.
// Chat passes the Application (global) options; Workspace passes its
// feature sections (M4).
const props = defineProps<{
  open: boolean;
  title: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="props.open" class="drawer-layer">
        <div class="scrim" @click="emit('close')" />
        <aside class="drawer" role="dialog" :aria-label="props.title">
          <header class="drawer-header">
            <p class="drawer-title">{{ props.title }}</p>
            <IconButton label="Close menu" @click="emit('close')">
              <X :size="15" />
            </IconButton>
          </header>
          <div class="drawer-body">
            <slot />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-layer {
  position: fixed;
  inset: 40px 0 0 0;
  z-index: 40;
  display: flex;
}

.scrim {
  position: absolute;
  inset: 0;
  background: var(--bg-overlay);
}

.drawer {
  position: relative;
  width: 300px;
  height: 100%;
  background: var(--bg-panel);
  border-right: 1px solid var(--hair-strong);
  box-shadow: var(--shadow-overlay);
  display: grid;
  grid-template-rows: auto 1fr;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid var(--hair);
}

.drawer-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.drawer-body {
  overflow-y: auto;
  padding: 10px;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity var(--t-slow) var(--ease-out);
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform var(--t-slow) var(--ease-out);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(-24px);
}

@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active,
  .drawer-enter-active .drawer,
  .drawer-leave-active .drawer {
    transition: none;
  }
}
</style>
