<script setup lang="ts">
import { PhSlidersHorizontal as SlidersHorizontal } from "@phosphor-icons/vue";
import { GLOBAL_SCOPE_KEY, useCustomizeStore } from "../../stores/customize-store.js";
import { WORKSPACE_ONLY_SECTION_IDS } from "../workspace/workspace-sections.js";
import SectionHeader from "../sections/SectionHeader.vue";
import MenuEditor from "./MenuEditor.vue";
import PersonaIconPicker from "./PersonaIconPicker.vue";

// The Global surface's Customize canvas: the assistant here IS Claude (no
// name or accent to change — gold stays presence-only), so the persona card
// offers only the conversation icon; the menu editor mirrors the workspace
// one, minus the workspace-only sections (no global surface for them).
const store = useCustomizeStore();
const cardClass = "rounded-lg border border-hair bg-panel p-3.5";
</script>

<template>
  <div class="customize-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SlidersHorizontal"
      title="Customize"
      subtitle="Make the Global surface yours — its icon and its menu"
    >
      <template #actions>
        <button
          v-if="store.isCustomized(GLOBAL_SCOPE_KEY)"
          type="button"
          class="reset-button inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="store.reset(GLOBAL_SCOPE_KEY)"
        >
          Reset
        </button>
      </template>
    </SectionHeader>

    <div :class="cardClass">
      <p class="m-0 pb-2.5 text-sm font-semibold text-ink-1">Persona</p>
      <PersonaIconPicker :scope-key="GLOBAL_SCOPE_KEY" />
    </div>

    <div :class="cardClass">
      <p class="m-0 pb-0.5 text-sm font-semibold text-ink-1">Menu</p>
      <p class="m-0 pb-2.5 text-xs text-ink-2">
        Choose what shows in the Global menu and how it's grouped. Hiding a
        menu never limits what Claude can do — it only tidies the list.
      </p>
      <MenuEditor
        :scope-key="GLOBAL_SCOPE_KEY"
        :exclude-section-ids="WORKSPACE_ONLY_SECTION_IDS"
      />
    </div>
  </div>
</template>
