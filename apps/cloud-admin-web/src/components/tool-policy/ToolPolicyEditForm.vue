<script setup lang="ts">
import { computed, reactive } from "vue";
import {
  SESSION_SURFACE_KINDS,
  TOOL_CARD_CLASSES,
  type SessionSurfaceKind,
} from "@vynel/contracts/tool-policy/catalog";
import type { ToolPolicyDefaultFields } from "@vynel/contracts/tool-policy/defaults";
import { ALL_FEATURE_KEYS } from "@vynel/contracts/hub/entitlements";
import { AdminApiError } from "../../lib/admin-api.js";
import { useSaveToolPolicyDefault } from "../../composables/tool-policy/use-save-tool-policy-default.js";
import type { EffectiveToolRow } from "./effective-tool-policy.js";

const props = defineProps<{
  row: EffectiveToolRow;
  capabilityIds: string[];
}>();
const emit = defineEmits<{ close: [] }>();

const saveMutation = useSaveToolPolicyDefault();

// '' stands in for null (inherit) in every <select> — options can't carry
// null. The parent keys this component by toolName, so the baseline is
// captured once per tool and a background refetch can't clobber edits.
function baselineForm() {
  const override = props.row.override;
  // The annotation stops TS widening the literal union to string inside the
  // mutable form object.
  const cardClass: "" | (typeof TOOL_CARD_CLASSES)[number] =
    override?.cardClass ?? "";
  return {
    enabled: override?.enabled == null ? "" : override.enabled ? "on" : "off",
    cardClass,
    inheritSurfaces: override?.surfaces == null,
    surfaces: new Set<SessionSurfaceKind>(
      override?.surfaces ?? props.row.entry.surfaces,
    ),
    featureKey: override?.featureKey ?? "",
    capabilityId: override?.capabilityId ?? "",
  };
}

const form = reactive(baselineForm());

const fields = computed<ToolPolicyDefaultFields>(() => ({
  enabled: form.enabled === "" ? null : form.enabled === "on",
  cardClass: form.cardClass === "" ? null : form.cardClass,
  // Canonical kind order keeps the wire array stable regardless of the
  // order boxes were ticked in.
  surfaces: form.inheritSurfaces
    ? null
    : SESSION_SURFACE_KINDS.filter((kind) => form.surfaces.has(kind)),
  featureKey: form.featureKey === "" ? null : form.featureKey,
  capabilityId: form.capabilityId === "" ? null : form.capabilityId,
}));

const baselineFields = computed<ToolPolicyDefaultFields>(() => {
  const override = props.row.override;
  return {
    enabled: override?.enabled ?? null,
    cardClass: override?.cardClass ?? null,
    surfaces: override?.surfaces ?? null,
    featureKey: override?.featureKey ?? null,
    capabilityId: override?.capabilityId ?? null,
  };
});

const isDirty = computed(
  () => JSON.stringify(fields.value) !== JSON.stringify(baselineFields.value),
);

const declaredGateLabel = (declared: string | undefined) =>
  `inherit (${declared ?? "ungated"})`;

const errorMessage = computed(() => {
  const error = saveMutation.error.value;
  if (error === null) return null;
  return error instanceof AdminApiError
    ? error.message
    : "Saving failed — try again.";
});

function toggleSurface(kind: SessionSurfaceKind, checked: boolean) {
  if (checked) form.surfaces.add(kind);
  else form.surfaces.delete(kind);
}

function save() {
  saveMutation.mutate(
    { toolName: props.row.entry.toolName, fields: fields.value },
    { onSuccess: () => emit("close") },
  );
}
</script>

<template>
  <form class="card edit-card" @submit.prevent="save">
    <div class="field-row">
      <label class="field">
        <span class="field-label">Enabled</span>
        <select v-model="form.enabled" class="select-input">
          <option value="">inherit (on)</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Card class</span>
        <select v-model="form.cardClass" class="select-input">
          <option value="">inherit ({{ row.entry.cardClass }})</option>
          <option
            v-for="cardClass in TOOL_CARD_CLASSES"
            :key="cardClass"
            :value="cardClass"
          >
            {{ cardClass }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Feature gate</span>
        <select v-model="form.featureKey" class="select-input">
          <option value="">
            {{ declaredGateLabel(row.entry.featureKey) }}
          </option>
          <option value="none">none (ungate)</option>
          <option v-for="key in ALL_FEATURE_KEYS" :key="key" :value="key">
            {{ key }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Capability gate</span>
        <select v-model="form.capabilityId" class="select-input">
          <option value="">
            {{ declaredGateLabel(row.entry.capabilityId) }}
          </option>
          <option value="none">none (ungate)</option>
          <option v-for="id in capabilityIds" :key="id" :value="id">
            {{ id }}
          </option>
        </select>
      </label>
    </div>
    <div class="field">
      <label class="surfaces-inherit">
        <input v-model="form.inheritSurfaces" type="checkbox" />
        <span>
          Inherit surfaces ({{ row.entry.surfaces.length }} declared:
          {{ row.entry.surfaces.join(", ") }})
        </span>
      </label>
      <div v-if="!form.inheritSurfaces" class="surface-grid">
        <label
          v-for="kind in SESSION_SURFACE_KINDS"
          :key="kind"
          class="surface-option"
        >
          <input
            type="checkbox"
            :checked="form.surfaces.has(kind)"
            @change="
              toggleSurface(kind, ($event.target as HTMLInputElement).checked)
            "
          />
          <span>{{ kind }}</span>
        </label>
      </div>
    </div>
    <div class="edit-actions">
      <button
        type="submit"
        class="button button-primary"
        :disabled="!isDirty || saveMutation.isPending.value"
      >
        {{ saveMutation.isPending.value ? "Saving…" : "Save" }}
      </button>
      <button type="button" class="button" @click="emit('close')">
        Cancel
      </button>
    </div>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
  </form>
</template>

<style scoped>
.edit-card {
  margin: 4px 0 8px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 12px;
}

.surfaces-inherit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-2);
}

.surface-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 4px 12px;
  margin-top: 8px;
}

.surface-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--ink-2);
}

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>
