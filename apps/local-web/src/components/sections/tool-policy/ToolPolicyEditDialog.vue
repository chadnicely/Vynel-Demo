<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { HubFeatureKey } from "@vynel/contracts/hub/entitlements";
import type { WorkspaceCapabilityId } from "../../../composables/capabilities/use-workspace-capabilities.js";
import { useSaveToolPolicy } from "../../../composables/tool-policies/use-save-tool-policy.js";
import type {
  EffectiveToolPolicy,
  SessionSurfaceKind,
  ToolCardClass,
} from "../../../composables/tool-policies/tool-policy-contract.js";
import {
  SESSION_SURFACE_KINDS,
  TOOL_CARD_CLASSES,
} from "../../../composables/tool-policies/tool-policy-contract.js";
import { formatSdkError } from "../../../utils/format-sdk-error.js";
import PolicyField from "./PolicyField.vue";
import {
  CAPABILITY_OPTIONS,
  CARD_CLASS_LABELS,
  SURFACE_LABELS,
  TIER_OPTIONS,
  asHubFeatureKey,
  shortToolNameOf,
} from "./tool-policy-labels.js";

// Edit one tool's policy. PUT is FULL-REPLACE: every field rides in the body,
// null meaning "inherit the declared default" — so each field pairs its
// control with an "Inherit default" checkbox, and Save writes exactly what
// the form shows.
const props = defineProps<{
  open: boolean;
  tool: EffectiveToolPolicy | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const savePolicy = useSaveToolPolicy();

const inheritEnabled = ref(true);
const enabledValue = ref(true);
const inheritCardClass = ref(true);
const cardClassValue = ref<ToolCardClass>("ask");
const inheritSurfaces = ref(true);
const surfacesValue = ref<SessionSurfaceKind[]>([]);
const inheritFeatureKey = ref(true);
const featureKeyValue = ref<HubFeatureKey | "none">("none");
const inheritCapability = ref(true);
const capabilityValue = ref<WorkspaceCapabilityId | "none">("none");

function asCapabilityOptionId(
  value: string | undefined,
): WorkspaceCapabilityId | "none" {
  const match = CAPABILITY_OPTIONS.find((option) => option.id === value);
  return match ? match.id : "none";
}

watch(
  () => props.open,
  (open) => {
    if (!open || props.tool === null) return;
    const tool = props.tool;
    // The wire says only THAT an override exists (hasOverride), not which
    // fields it covers — and the PUT replaces all five. Seeding a customized
    // tool fully pinned keeps a save from silently handing untouched fields
    // back to the defaults; a pristine tool seeds fully inheriting. Checking
    // every box and saving equals a reset (all-null body).
    const inherit = !tool.hasOverride;
    inheritEnabled.value = inherit;
    enabledValue.value = tool.enabled;
    inheritCardClass.value = inherit;
    cardClassValue.value = tool.cardClass;
    inheritSurfaces.value = inherit;
    surfacesValue.value = [...tool.surfaces];
    inheritFeatureKey.value = inherit;
    featureKeyValue.value = asHubFeatureKey(tool.featureKey) ?? "none";
    inheritCapability.value = inherit;
    capabilityValue.value = asCapabilityOptionId(tool.capabilityId);
    savePolicy.reset();
  },
  { immediate: true },
);

function toggleSurface(kind: SessionSurfaceKind) {
  surfacesValue.value = surfacesValue.value.includes(kind)
    ? surfacesValue.value.filter((entry) => entry !== kind)
    : [...surfacesValue.value, kind];
}

const errorMessage = computed(() =>
  savePolicy.error.value ? formatSdkError(savePolicy.error.value) : null,
);

const dialogTitle = computed(() =>
  props.tool !== null ? shortToolNameOf(props.tool) : "Tool policy",
);
const dialogDescription = computed(() =>
  props.tool !== null
    ? `${props.tool.toolName} — fields you set here pin this tool; inherited fields keep following Vynel's defaults.`
    : "",
);

function submit() {
  if (props.tool === null || savePolicy.isPending.value) return;
  savePolicy.mutate(
    {
      toolName: props.tool.toolName,
      body: {
        enabled: inheritEnabled.value ? null : enabledValue.value,
        cardClass: inheritCardClass.value ? null : cardClassValue.value,
        surfaces: inheritSurfaces.value ? null : [...surfacesValue.value],
        featureKey: inheritFeatureKey.value ? null : featureKeyValue.value,
        capabilityId: inheritCapability.value ? null : capabilityValue.value,
      },
    },
    { onSuccess: () => emit("close") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="dialogTitle"
    :description="dialogDescription"
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-4 pt-1">
      <PolicyField
        v-model:inherit="inheritEnabled"
        class="field-enabled"
        label="Enabled"
      >
        <button
          type="button"
          role="switch"
          :aria-checked="enabledValue"
          :disabled="inheritEnabled"
          class="enabled-switch flex w-fit cursor-default items-center gap-1.5 text-[11.5px] font-medium text-ink-2 transition enabled:hover:text-ink-1 disabled:opacity-55"
          @click="enabledValue = !enabledValue"
        >
          <span
            class="relative h-3.5 w-6 rounded-full border transition"
            :class="
              enabledValue
                ? 'border-gold bg-gold-soft'
                : 'border-hair-strong bg-panel'
            "
          >
            <span
              class="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-all"
              :class="
                enabledValue ? 'left-[11px] bg-gold' : 'left-[2px] bg-ink-3'
              "
            />
          </span>
          {{ enabledValue ? "On" : "Off" }}
        </button>
      </PolicyField>

      <PolicyField
        v-model:inherit="inheritCardClass"
        class="field-card-class"
        label="Approval cards"
      >
        <div
          class="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Approval card class"
        >
          <button
            v-for="option in TOOL_CARD_CLASSES"
            :key="option"
            type="button"
            class="card-class-chip cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition disabled:opacity-55"
            :class="
              cardClassValue === option
                ? 'border-gold bg-gold-soft text-ink-1'
                : 'border-hair bg-panel text-ink-2 enabled:hover:border-hair-strong enabled:hover:text-ink-1'
            "
            :aria-pressed="cardClassValue === option"
            :disabled="inheritCardClass"
            @click="cardClassValue = option"
          >
            {{ CARD_CLASS_LABELS[option] }}
          </button>
        </div>
      </PolicyField>

      <PolicyField
        v-model:inherit="inheritSurfaces"
        class="field-surfaces"
        label="Surfaces"
      >
        <div
          class="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Surfaces this tool may attach to"
        >
          <button
            v-for="kind in SESSION_SURFACE_KINDS"
            :key="kind"
            type="button"
            class="surface-chip cursor-default rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-55"
            :class="
              surfacesValue.includes(kind)
                ? 'border-gold bg-gold-soft text-ink-1'
                : 'border-hair bg-panel text-ink-2 enabled:hover:border-hair-strong enabled:hover:text-ink-1'
            "
            :aria-pressed="surfacesValue.includes(kind)"
            :disabled="inheritSurfaces"
            @click="toggleSurface(kind)"
          >
            {{ SURFACE_LABELS[kind] }}
          </button>
        </div>
        <p
          v-if="!inheritSurfaces && surfacesValue.length === 0"
          class="m-0 text-[11px] text-ink-3"
        >
          No surfaces selected — the tool will attach nowhere.
        </p>
      </PolicyField>

      <PolicyField
        v-model:inherit="inheritFeatureKey"
        class="field-tier"
        label="Tier"
      >
        <select
          v-model="featureKeyValue"
          :disabled="inheritFeatureKey"
          aria-label="Tier feature gate"
          class="tier-select w-full cursor-default rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 disabled:opacity-55"
        >
          <option
            v-for="option in TIER_OPTIONS"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </option>
        </select>
      </PolicyField>

      <PolicyField
        v-model:inherit="inheritCapability"
        class="field-capability"
        label="Capability"
      >
        <select
          v-model="capabilityValue"
          :disabled="inheritCapability"
          aria-label="Capability gate"
          class="capability-select w-full cursor-default rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 disabled:opacity-55"
        >
          <option
            v-for="option in CAPABILITY_OPTIONS"
            :key="option.id"
            :value="option.id"
          >
            {{ option.label }}
          </option>
        </select>
      </PolicyField>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="save-button cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="savePolicy.isPending.value"
        @click="submit"
      >
        {{ savePolicy.isPending.value ? "Saving…" : "Save policy" }}
      </button>
    </template>
  </Modal>
</template>
