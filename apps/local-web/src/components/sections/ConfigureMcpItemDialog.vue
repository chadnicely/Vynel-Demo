<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";

// The configure step between Get and installed for an mcp item whose
// manifest declares required values (API keys, tokens). Purely a collector:
// the section owns the install mutation, so pending and error state stay on
// the card the user clicked (the AddMcpServerDialog stays the sibling for
// hand-added servers). Values leave this form exactly once, in the install
// request — never kept, never echoed back.
const props = defineProps<{
  open: boolean;
  item: MarketplaceItem | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [values: Record<string, string>];
}>();

const fields = computed(() =>
  props.item?.mcpAuth?.kind === "fields" ? props.item.mcpAuth.fields : [],
);

const values = ref<Record<string, string>>({});

// Reset on BOTH edges: open primes one blank input per declared field, and
// close clears typed secrets immediately — "never kept" includes the ref.
watch(
  () => props.open,
  (open) => {
    values.value = open
      ? Object.fromEntries(fields.value.map((field) => [field.name, ""]))
      : {};
  },
  { immediate: true },
);

const canSubmit = computed(() =>
  fields.value.every((field) => (values.value[field.name] ?? "").trim() !== ""),
);

function submit() {
  if (!canSubmit.value) return;
  emit("submit", { ...values.value });
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="`Set up ${props.item?.displayName ?? 'this server'}`"
    description="This connection needs a few values of yours before it can work. They are written into your Claude configuration — never sent anywhere else."
    size="sm"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label v-for="field in fields" :key="field.name" class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">{{ field.label }}</span>
        <input
          v-model="values[field.name]"
          :type="field.secret ? 'password' : 'text'"
          :autocomplete="field.secret ? 'new-password' : undefined"
          maxlength="2000"
          :placeholder="field.name"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>
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
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canSubmit"
        @click="submit"
      >
        Install
      </button>
    </template>
  </Modal>
</template>
