<script setup lang="ts">
import { computed, ref } from "vue";
import { Eye, ScrollText } from "lucide-vue-next";
import { EmptyState, MarkdownText, Modal } from "@vynel/ui";
import { useRules } from "../../composables/rules/use-rules.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The rules on either surface — EVERY `.claude/rules/*.md` file Claude Code
// loads there, the user's hand-written ones included. A marketplace-installed
// rule wears a "Managed by Vynel" chip (the AgentsSection SOURCE_LABELS
// idiom); rows open read-only in a dialog. Editing is deliberately out of
// scope for v1 — these are the user's own files on disk.
const props = defineProps<{
  scope: SectionScope;
}>();

const rulesQuery = useRules(() => props.scope);
const rules = computed(() => rulesQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();

function scopeChip(rowScope: "user" | "workspace"): string {
  if (rowScope === "user") return "Global";
  return props.scope.kind === "workspace"
    ? scopeLabel(props.scope.workspaceId)
    : "Workspace";
}

type OpenRule = { title: string; content: string };
const viewingRule = ref<OpenRule | null>(null);

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Standing instructions Claude follows in every workspace"
    : "Standing instructions it always follows here",
);
</script>

<template>
  <div class="rules-section flex flex-col gap-2.5">
    <SectionHeader :icon="ScrollText" title="Rules" :subtitle="sectionHint" />

    <div v-if="rules.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="rule in rules"
        :key="`${rule.scope}:${rule.ruleId}`"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <button
          type="button"
          class="row-open flex min-w-0 flex-1 cursor-default items-center gap-3 border-0 bg-transparent p-0 text-left"
          @click="viewingRule = { title: rule.title, content: rule.content }"
        >
          <span
            class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ws-4/12 text-ws-4"
          >
            <ScrollText :size="17" />
          </span>
          <div class="row-main min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
                {{ rule.title }}
              </p>
              <span
                v-if="rule.marketplace !== null"
                class="managed-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
                >Managed by Vynel</span
              >
              <span
                class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
                >{{ scopeChip(rule.scope) }}</span
              >
            </div>
            <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
              {{ rule.fileName
              }}<template v-if="rule.marketplace !== null">
                · v{{ rule.marketplace.version }}</template
              >
            </p>
          </div>
        </button>
        <span
          class="view-hint shrink-0 rounded-md p-1 text-ink-3 opacity-0 transition group-hover:opacity-100"
          aria-hidden="true"
        >
          <Eye :size="14" />
        </span>
      </div>
    </div>

    <EmptyState
      v-else
      title="No rules yet"
      hint="Rules are standing instructions Claude always follows — install one from the Marketplace, or drop a Markdown file into the .claude/rules folder."
    >
      <template #icon>
        <ScrollText :size="22" />
      </template>
    </EmptyState>

    <!-- Read-only view — the same sanitized renderer chat uses. -->
    <Modal
      :open="viewingRule !== null"
      size="lg"
      description="Read-only view of this rule file."
      @update:open="(open: boolean) => !open && (viewingRule = null)"
    >
      <template #title>{{ viewingRule?.title }}</template>
      <div
        v-if="viewingRule !== null"
        class="rule-body rounded-sm border border-hair bg-panel p-3 text-sm leading-[1.65] text-ink-1 break-words"
      >
        <MarkdownText :source="viewingRule.content" />
      </div>
    </Modal>
  </div>
</template>
