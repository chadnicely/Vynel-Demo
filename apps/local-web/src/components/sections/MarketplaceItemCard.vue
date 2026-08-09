<script setup lang="ts">
import { computed } from "vue";
import { BadgeCheck, Check } from "lucide-vue-next";
import { workspaceMonogram } from "@vynel/ui";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import { isCatalogIconName } from "@vynel/contracts/marketplace/catalog-icons";
import { CATALOG_ICONS } from "./catalog-icons.js";

// One storefront card. Purely presentational — the section owns the single
// install/uninstall mutation pair, so pending and error state stay scoped to
// the card the user actually clicked (the AccountSection idiom).
const props = defineProps<{
  item: MarketplaceItem;
  isPro: boolean;
  isInstalling: boolean;
  isUpdating: boolean;
  isRemoving: boolean;
  isRemoveArmed: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  errorMessage: string | null;
}>();

const emit = defineEmits<{
  install: [];
  update: [];
  connect: [];
  "remove-request": [];
  "remove-blur": [];
}>();

// The shared catalog-icon map (typed to the contracts allowlist); an unknown
// name falls back to the item's monogram (the workspace-mark idiom — a
// stable, derived initial).
const tileIcon = computed(() =>
  isCatalogIconName(props.item.iconName) ? CATALOG_ICONS[props.item.iconName] : null,
);
const monogram = computed(() => workspaceMonogram(props.item.displayName));

const isInstalled = computed(
  () => props.item.installStatus.kind === "installed",
);

// The official badge's wording is provenance-honest (Chad, 2026-08-01):
// Anthropic-published items say so plainly; Vynel-verified items keep
// "Official". Community rows (isOfficial false) get neither.
const officialBadgeLabel = computed(() =>
  props.item.publisherTier === "anthropic-official" ? "By Anthropic" : "Official",
);

// Skills (hub artifact — `hasCloudArtifact` keeps the button off
// bundled-only items the daemon would 400) and plugins (the Claude CLI
// delegate updates in place) offer Update; agents carry no installed
// version (null) and mcp/rule refresh by reinstall, so their cards never
// claim an update they can't perform. `item.version` is the catalog's
// latest (cloud-wins merge), the only update target. Deliberately `!==`,
// not "newer than": a cloud-wins downgrade is still "get what the card
// shows", and installed versions aren't guaranteed semver.
const hasUpdate = computed(() => {
  const { installStatus } = props.item;
  if (installStatus.kind !== "installed") return false;
  // A version-less catalog row (a third-party marketplace.json that
  // declares none — item.version '') can't honestly claim the catalog is
  // ahead: comparing nothing against the CLI registry's real installed
  // version showed a permanent phantom Update.
  if (
    props.item.version === "" ||
    installStatus.versionInstalled === null ||
    installStatus.versionInstalled === props.item.version
  )
    return false;
  if (props.item.kind === "skill") return props.item.hasCloudArtifact;
  return props.item.kind === "plugin";
});

const updateLabel = computed(() =>
  props.isUpdating ? "Updating…" : "Update",
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

// An installed OAuth connector needs the native browser sign-in before it
// works; the button is idempotent (re-connecting refreshes the credential),
// so it stays available — "Connected" is the transient success readback.
const showsConnect = computed(
  () => isInstalled.value && props.item.mcpAuth?.kind === "oauth",
);

const connectLabel = computed(() => {
  if (props.isConnecting) return "Connecting…";
  return props.isConnected ? "Connected" : "Connect";
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
        <p class="m-0 mt-0.5 flex flex-wrap items-center gap-1.5">
          <!-- What you're getting: a skill (a capability), an agent (a
               persona), a plugin (a bundle Claude Code itself manages),
               an MCP server (a tool connection written into the Claude
               config), or a rule (a guidance file in .claude/rules/) —
               the Get flow is identical for all five. -->
          <span
            class="scope-chip inline-flex items-center gap-0.5 rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >{{
              item.kind === "agent"
                ? "Agent"
                : item.kind === "plugin"
                  ? "Plugin"
                  : item.kind === "mcp"
                    ? "MCP"
                    : item.kind === "rule"
                      ? "Rule"
                      : "Skill"
            }}</span
          >
          <span
            v-if="item.isOfficial"
            class="scope-chip is-gold inline-flex items-center gap-0.5 rounded-full border border-gold-soft bg-gold-soft px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-gold"
          >
            <BadgeCheck :size="10" />
            {{ officialBadgeLabel }}
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

    <!-- Credit line: every resource names its origin (publisher + upstream
         source when it has one) with real links — provenance, not chrome. -->
    <p class="credit-line m-0 truncate text-2xs text-ink-3">
      By
      <a
        v-if="item.publisherUrl"
        :href="item.publisherUrl"
        target="_blank"
        rel="noreferrer"
        class="underline decoration-hair-strong underline-offset-2 hover:text-ink-1"
        >{{ item.publisherName }}</a
      >
      <template v-else>{{ item.publisherName }}</template>
      <template v-if="item.sourceUrl">
        ·
        <a
          :href="item.sourceUrl"
          target="_blank"
          rel="noreferrer"
          class="underline decoration-hair-strong underline-offset-2 hover:text-ink-1"
          >Source</a
        >
      </template>
    </p>

    <footer class="mt-auto flex items-center justify-between gap-2">
      <p class="m-0 min-w-0 truncate text-2xs text-ink-3">
        <span class="capitalize">{{ item.category }}</span>
        <template v-if="item.version !== ''">· v{{ item.version }}</template>
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
        <!-- Connect drives the native browser sign-in (claude mcp login);
             the credential lands in Claude's own store, never in Vynel. -->
        <button
          v-if="showsConnect"
          type="button"
          class="pill is-connect inline-flex cursor-default items-center gap-1 rounded-full px-2.5 py-px text-[11px] font-semibold transition disabled:opacity-55"
          :class="
            isConnected
              ? 'bg-ok/15 text-ok'
              : 'bg-info/15 text-info hover:bg-info/25'
          "
          :disabled="isConnecting"
          :aria-label="`Connect ${item.displayName} — opens your browser to sign in`"
          @click="emit('connect')"
        >
          <Check v-if="isConnected" :size="11" />
          {{ connectLabel }}
        </button>
        <!-- Update replaces the installed files with the catalog's newer
             version (skills from the hub artifact, plugins via Claude
             Code's plugin system); the version line shows the target. -->
        <button
          v-if="hasUpdate"
          type="button"
          class="pill is-update inline-flex cursor-default items-center rounded-full bg-info/15 px-2.5 py-px text-[11px] font-semibold text-info transition hover:bg-info/25 disabled:opacity-55"
          :disabled="isUpdating"
          :aria-label="`Update ${item.displayName} to v${item.version}`"
          @click="emit('update')"
        >
          {{ updateLabel }}
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
              ? `Confirm remove ${item.displayName} — its settings are deleted too`
              : `Remove ${item.displayName}`
          "
          @click="emit('remove-request')"
          @blur="emit('remove-blur')"
        >
          {{ removeLabel }}
        </button>
      </div>
    </footer>

    <!-- Removal is total (install/uninstall-only — no pause state that
         preserves settings), so the armed state says what's at stake. -->
    <p v-if="isRemoveArmed" class="m-0 text-[11px] text-danger">
      Removes it from this device and deletes its settings.
    </p>

    <p v-if="errorMessage" class="m-0 text-[11px] text-danger" role="alert">
      {{ errorMessage }}
    </p>
  </article>
</template>
