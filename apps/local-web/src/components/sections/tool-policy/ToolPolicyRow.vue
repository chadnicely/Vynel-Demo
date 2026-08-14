<script setup lang="ts">
import { computed } from "vue";
import { PhLock as Lock, PhPencilSimple as Pencil } from "@phosphor-icons/vue";
import { ConfirmButton } from "@vynel/ui";
import type { EffectiveToolPolicy } from "../../../composables/tool-policies/tool-policy-contract.js";
import { SESSION_SURFACE_KINDS } from "../../../composables/tool-policies/tool-policy-contract.js";
import {
  CARD_CLASS_LABELS,
  SURFACE_LABELS,
  capabilityLabelOf,
  featureKeyLabelOf,
  shortToolNameOf,
} from "./tool-policy-labels.js";

// One tool's EFFECTIVE row, read-only: the merge the resolver hands every
// surface. Editing goes through the dialog — PUT is full-replace, so an
// in-row toggle would clobber the sibling fields — leaving the row just
// Edit + Reset.
const props = defineProps<{
  tool: EffectiveToolPolicy;
  /** The live entitlement lacks this row's tier — grey it (display only). */
  tierLocked: boolean;
  resetPending: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  reset: [];
}>();

const shortName = computed(() => shortToolNameOf(props.tool));

const surfacesSummary = computed(() =>
  props.tool.surfaces.length === SESSION_SURFACE_KINDS.length
    ? "All surfaces"
    : `${props.tool.surfaces.length}/${SESSION_SURFACE_KINDS.length} surfaces`,
);

const surfacesTitle = computed(
  () =>
    props.tool.surfaces.map((kind) => SURFACE_LABELS[kind]).join(", ") ||
    "Attached to no surface",
);
</script>

<template>
  <div
    class="tool-row group flex items-center gap-3 rounded-lg border border-hair bg-raised px-3 py-2 transition hover:border-hair-strong"
    :class="{ 'opacity-60': props.tierLocked || !props.tool.enabled }"
  >
    <div class="row-main min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <p
          class="tool-name m-0 truncate font-mono text-[12.5px] font-semibold text-ink-1"
          :title="props.tool.toolName"
        >
          {{ shortName }}
        </p>
        <span
          v-if="props.tool.hasOverride"
          class="override-dot size-1.5 shrink-0 rounded-full bg-gold"
          title="Customized — this tool has its own policy"
        />
        <span
          v-if="!props.tool.enabled"
          class="off-chip inline-flex shrink-0 items-center rounded-full bg-danger/15 px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-danger"
          >Off</span
        >
        <span
          v-if="props.tool.featureKey"
          class="pro-chip inline-flex shrink-0 items-center rounded-full bg-gold-soft px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-gold-bright"
          :title="`Requires the ${featureKeyLabelOf(props.tool.featureKey)} feature (Pro)`"
          >Pro</span
        >
        <span
          v-if="props.tierLocked"
          class="lock-chip inline-flex shrink-0 items-center text-ink-3"
          title="Your current plan doesn't include this tool's feature"
        >
          <Lock :size="11" />
        </span>
      </div>
      <div class="mt-0.5 flex flex-wrap items-center gap-1">
        <span
          class="meta-chip inline-flex items-center rounded-full border border-hair px-1.5 py-px text-[10px] text-ink-3"
          :title="`Approval cards: ${CARD_CLASS_LABELS[props.tool.cardClass]}`"
          >Cards: {{ CARD_CLASS_LABELS[props.tool.cardClass] }}</span
        >
        <span
          class="meta-chip surfaces-chip inline-flex items-center rounded-full border border-hair px-1.5 py-px text-[10px] text-ink-3"
          :title="surfacesTitle"
          >{{ surfacesSummary }}</span
        >
        <span
          v-if="props.tool.capabilityId"
          class="meta-chip capability-chip inline-flex items-center rounded-full border border-hair px-1.5 py-px text-[10px] text-ink-3"
          :title="`Only attaches where the ${capabilityLabelOf(props.tool.capabilityId)} capability is on`"
          >Needs {{ capabilityLabelOf(props.tool.capabilityId) }}</span
        >
      </div>
    </div>

    <button
      type="button"
      class="edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
      :title="`Edit the policy for ${shortName}`"
      :aria-label="`Edit the policy for ${shortName}`"
      @click="emit('edit')"
    >
      <Pencil :size="14" />
    </button>
    <ConfirmButton
      v-if="props.tool.hasOverride"
      class="reset-button shrink-0 !px-2 !py-0.5 !text-[11px]"
      label="Reset"
      confirm-label="Sure?"
      danger
      :busy="props.resetPending"
      @confirm="emit('reset')"
    />
  </div>
</template>
