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
  <article class="item-card">
    <div class="card-head">
      <span class="card-tile" aria-hidden="true">
        <component :is="tileIcon" v-if="tileIcon" :size="16" />
        <span v-else class="tile-monogram">{{ monogram }}</span>
      </span>
      <div class="card-heading">
        <p class="card-title">{{ item.displayName }}</p>
        <p class="card-chips">
          <!-- What you're getting: a skill (a capability) or an agent
               (a persona) — the Get flow is identical for both. -->
          <span class="scope-chip">{{
            item.kind === "agent" ? "Agent" : "Skill"
          }}</span>
          <span v-if="item.isOfficial" class="scope-chip is-gold">
            <BadgeCheck :size="10" />
            Official
          </span>
          <span v-if="showsProBadge" class="scope-chip is-pro">Pro</span>
        </p>
      </div>
    </div>

    <p class="card-description">{{ item.oneLineDescription }}</p>

    <footer class="card-foot">
      <p class="card-meta">
        <span class="meta-category">{{ item.category }}</span>
        · v{{ item.version }}
      </p>
      <div class="card-actions">
        <!-- Install dispatches cloud vs. bundled server-side; the button just
             names the item. Installed stays disabled (no re-install). -->
        <button
          type="button"
          class="pill"
          :class="isInstalled ? 'is-on' : 'is-off'"
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
          class="row-action"
          :class="{ 'is-danger': isRemoveArmed }"
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

    <p v-if="errorMessage" class="card-error" role="alert">
      {{ errorMessage }}
    </p>
  </article>
</template>

<style scoped>
.item-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  transition:
    border-color var(--t-fast) var(--ease-out),
    box-shadow var(--t-fast) var(--ease-out),
    transform var(--t-fast) var(--ease-out);
}

.item-card:hover {
  border-color: var(--hair-strong);
  box-shadow: var(--shadow-raised);
  transform: translateY(-1px);
}

@media (prefers-reduced-motion: reduce) {
  .item-card,
  .item-card:hover {
    transform: none;
  }
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.card-tile {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  flex: none;
}

.tile-monogram {
  font: 600 12px/1 var(--font-display);
  letter-spacing: 0.03em;
}

.card-heading {
  min-width: 0;
  flex: 1;
}

.card-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-chips {
  margin: 2px 0 0;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

/* Gold marks team-shipped presence — only the Official chip may wear it. */
.scope-chip.is-gold {
  color: var(--gold);
  border-color: var(--gold-soft);
  background: var(--gold-soft);
}

/* Distinct from Official's gold (gold is presence-only) — the informational
   status token reads as "upgrade to reach this". */
.scope-chip.is-pro {
  color: var(--info);
  border-color: color-mix(in srgb, var(--info) 40%, transparent);
  background: color-mix(in srgb, var(--info) 14%, transparent);
}

.card-description {
  margin: 0;
  color: var(--ink-2);
  font: 400 11.5px/1.5 var(--font-ui);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* Two lines of room even for one-liners — grid rows stay even. */
  min-height: calc(11.5px * 1.5 * 2);
}

.card-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-meta {
  margin: 0;
  min-width: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Only the category is prose ("email" → "Email") — the version stays as-is. */
.meta-category {
  text-transform: capitalize;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.pill {
  appearance: none;
  margin: 0;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: 600 11px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 10px;
  cursor: default;
  transition: color var(--t-fast) var(--ease-out);
}

.pill.is-on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill.is-off {
  color: var(--ink-1);
  background: var(--row-active);
}

.pill.is-off:hover:not(:disabled) {
  background: var(--row-hover);
}

.pill:disabled {
  opacity: 0.8;
}

.pill:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* The Remove control + its armed "Sure?" step borrow the account section's
   row-action idiom (AccountDeviceRow). */
.row-action {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  padding: 1px 10px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.row-action:hover:not(:disabled) {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.row-action:disabled {
  opacity: 0.55;
}

.row-action.is-danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.row-action.is-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.row-action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.card-error {
  margin: 0;
  color: var(--danger);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
