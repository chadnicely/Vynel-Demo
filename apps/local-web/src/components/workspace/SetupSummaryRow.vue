<script setup lang="ts">
import { PhCheckCircle, PhLinkSimple } from "@phosphor-icons/vue";
import type { SetupRow } from "./finish-setup-rows.js";

// One read-only row of "Finish setting up": a green check (everything here was
// answered by LOOKING), the title, the plain-language body, the answer, and —
// for the AI-account row when nothing is connected — the one link out.
defineProps<{ row: SetupRow }>();

const emit = defineEmits<{ "connect-account": [] }>();
</script>

<template>
  <li class="setup-row grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-hair py-3 first:border-t-0">
    <PhCheckCircle :size="18" weight="fill" class="mt-0.5 shrink-0 text-ok" />
    <div class="grid gap-1">
      <span class="text-[13px] font-semibold text-ink-1">{{ row.title }}</span>
      <span class="text-[12px] leading-relaxed text-ink-3">{{ row.body }}</span>
      <span class="mt-0.5 text-[12.5px] text-ink-2">{{ row.value }}</span>

      <!-- ENV: the key NAMES only — the values are never read out of the file. -->
      <ul
        v-if="row.keyNames && row.keyNames.length > 0"
        class="m-0 mt-1 flex list-none flex-wrap gap-1 p-0"
      >
        <li
          v-for="name in row.keyNames"
          :key="name"
          class="rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
        >
          {{ name }}
        </li>
      </ul>
      <span v-if="row.keyNames" class="text-[11px] text-ink-3">
        We never read what is in them.
      </span>

      <!-- The one thing the folder cannot answer — accounts are global, so
           this is a link out, not a per-project pick. -->
      <button
        v-if="row.needsAccount"
        type="button"
        class="mt-1 inline-flex w-fit items-center gap-1.5 text-[12px] font-semibold text-gold transition hover:text-ink-1"
        @click="emit('connect-account')"
      >
        <PhLinkSimple :size="13" />
        Connect an account
      </button>
    </div>
  </li>
</template>
