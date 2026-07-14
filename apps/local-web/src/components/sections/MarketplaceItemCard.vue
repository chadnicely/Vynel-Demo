<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  BadgeCheck,
  Check,
  FileText,
  Inbox,
  Mail,
  Search,
} from "lucide-vue-next";
import { workspaceMonogram } from "@vynel/ui";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";

// One storefront card. Purely presentational — the section owns the single
// install/uninstall mutation pair, so pending and error state stay scoped to
// the card the user actually clicked (the AccountSection idiom).
const props = defineProps<{
  item: MarketplaceItem;
  isPro: boolean;
  isInstalling: boolean;
  isRemoving: boolean;
  isRemoveArmed: boolean;
  errorMessage: string | null;
}>();

const emit = defineEmits<{
  install: [];
  "remove-request": [];
  "remove-blur": [];
}>();

// The catalog's lucide names, mapped statically so the bundle only carries
// icons the shelf actually uses; an unknown name falls back to the item's
// monogram (the workspace-mark idiom — a stable, derived initial).
const CATALOG_ICONS: Record<string, Component> = {
  mail: Mail,
  inbox: Inbox,
  search: Search,
  "file-text": FileText,
};

const tileIcon = computed(() => CATALOG_ICONS[props.item.iconName] ?? null);
const monogram = computed(() => workspaceMonogram(props.item.displayName));

const isInstalled = computed(
  () => props.item.installStatus.kind === "installed",
);

// Display-only: the real install gate is server-side. Shows while the user
// can't yet install a pro-only item (not on Pro).
const showsProBadge = computed(
  () => props.item.minimumTier === "pro" && !props.isPro,
);

const installLabel = computed(() => {
  if (isInstalled.value) return "Installed";
  return props.isInstalling ? "Installing…" : "Get";
});

const removeLabel = computed(() => {
  if (props.isRemoveArmed) return "Sure?";
  return props.isRemoving ? "Removing…" : "Remove";
});
</script>

<template>
  <article
    class="item-card flex flex-col gap-2 rounded-md border border-hair bg-raised p-3 transition hover:-translate-y-px hover:border-hair-strong hover:shadow-raised motion-reduce:hover:translate-y-0"
  >
    <div class="flex items-start gap-2.5">
      <span
        class="grid size-[34px] shrink-0 place-items-center rounded-sm border border-hair bg-panel text-ink-2"
        aria-hidden="true"
      >
        <component :is="tileIcon" v-if="tileIcon" :size="16" />
        <span v-else class="font-display text-xs font-semibold tracking-wide">{{
          monogram
        }}</span>
      </span>
      <div class="min-w-0 flex-1">
        <p class="card-title m-0 truncate text-sm font-semibold text-ink-1">
          {{ item.displayName }}
        </p>
        <p class="mt-0.5 flex flex-wrap items-center gap-1.5">
          <!-- What you're getting: a skill (a capability) or an agent
               (a persona) — the Get flow is identical for both. -->
          <span
            class="scope-chip inline-flex items-center gap-0.5 rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >{{ item.kind === "agent" ? "Agent" : "Skill" }}</span
          >
          <span
            v-if="item.isOfficial"
            class="scope-chip is-gold inline-flex items-center gap-0.5 rounded-full border border-gold-soft bg-gold-soft px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-gold"
          >
            <BadgeCheck :size="10" />
            Official
          </span>
          <span
            v-if="showsProBadge"
            class="scope-chip is-pro inline-flex items-center rounded-full border border-info/40 bg-info/15 px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-info"
            >Pro</span
          >
        </p>
      </div>
    </div>

    <p
      class="m-0 line-clamp-2 min-h-[2.15rem] text-xs text-ink-2"
    >
      {{ item.oneLineDescription }}
    </p>

    <footer class="mt-auto flex items-center justify-between gap-2">
      <p class="m-0 min-w-0 truncate text-2xs text-ink-3">
        <span class="capitalize">{{ item.category }}</span>
        · v{{ item.version }}
      </p>
      <div class="flex shrink-0 items-center gap-1.5">
        <!-- Install dispatches cloud vs. bundled server-side; the button just
             names the item. Installed stays disabled (no re-install). -->
        <button
          type="button"
          class="pill inline-flex cursor-default items-center gap-1 rounded-full px-2.5 py-px text-[11px] font-semibold transition disabled:opacity-80"
          :class="
            isInstalled
              ? 'is-on bg-ok/15 text-ok'
              : 'is-off bg-row-active text-ink-1 hover:bg-row-hover'
          "
          :disabled="isInstalled || isInstalling"
          @click="emit('install')"
        >
          <Check v-if="isInstalled" :size="11" />
          {{ installLabel }}
        </button>
        <!-- Removal dispatches by installed kind server-side and flips the
             card back to Get; the arm-then-confirm two-step guards it. -->
        <button
          v-if="isInstalled"
          type="button"
          class="row-action inline-flex shrink-0 cursor-default items-center rounded-full border px-2.5 py-px text-[11px] font-semibold transition disabled:opacity-55"
          :class="
            isRemoveArmed
              ? 'is-danger border-danger/40 text-danger hover:border-danger hover:bg-danger/10'
              : 'border-hair text-ink-2 hover:border-hair-strong hover:bg-row-hover hover:text-ink-1'
          "
          :disabled="isRemoving"
          :aria-label="
            isRemoveArmed
              ? `Confirm remove ${item.displayName}`
              : `Remove ${item.displayName}`
          "
          @click="emit('remove-request')"
          @blur="emit('remove-blur')"
        >
          {{ removeLabel }}
        </button>
      </div>
    </footer>

    <p v-if="errorMessage" class="m-0 text-[11px] text-danger" role="alert">
      {{ errorMessage }}
    </p>
  </article>
</template>
