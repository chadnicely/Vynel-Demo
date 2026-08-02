<script setup lang="ts">
import { Plus, X } from "lucide-vue-next";

// A small name/value pair editor (headers, env vars) for the add-MCP form —
// one home so the two secret-bearing field sets share behavior. Values are
// masked as password inputs: they are secrets on their way to a config file,
// and must never linger readable on screen.
export type KeyValueRow = { name: string; value: string };

const props = defineProps<{
  label: string;
  rows: KeyValueRow[];
  namePlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}>();

const emit = defineEmits<{
  "update:rows": [rows: KeyValueRow[]];
}>();

function updateRow(index: number, patch: Partial<KeyValueRow>) {
  emit(
    "update:rows",
    props.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  );
}

function addRow() {
  emit("update:rows", [...props.rows, { name: "", value: "" }]);
}

function removeRow(index: number) {
  emit(
    "update:rows",
    props.rows.filter((_, i) => i !== index),
  );
}
</script>

<template>
  <div class="grid gap-1.5">
    <span class="text-[11.5px] font-semibold text-ink-2">{{ props.label }}</span>
    <div
      v-for="(row, index) in props.rows"
      :key="index"
      class="flex items-center gap-1.5"
    >
      <input
        :value="row.name"
        type="text"
        :placeholder="props.namePlaceholder"
        :aria-label="`${props.label} name`"
        class="w-2/5 rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink-1 placeholder:text-ink-3"
        @input="updateRow(index, { name: ($event.target as HTMLInputElement).value })"
      />
      <input
        :value="row.value"
        type="password"
        autocomplete="off"
        :placeholder="props.valuePlaceholder"
        :aria-label="`${props.label} value`"
        class="min-w-0 flex-1 rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink-1 placeholder:text-ink-3"
        @input="updateRow(index, { value: ($event.target as HTMLInputElement).value })"
      />
      <button
        type="button"
        class="shrink-0 cursor-default rounded-md p-1 text-ink-3 transition hover:bg-row-hover hover:text-danger"
        :aria-label="`Remove ${props.label.toLowerCase()} row`"
        @click="removeRow(index)"
      >
        <X :size="14" />
      </button>
    </div>
    <button
      type="button"
      class="inline-flex cursor-default items-center gap-1.5 self-start rounded-full border border-hair px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
      @click="addRow"
    >
      <Plus :size="12" />
      {{ props.addLabel }}
    </button>
  </div>
</template>
