<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhPencilSimple as Pencil,
  PhPlus as Plus,
  PhScroll as ScrollText,
  PhX as X,
} from "@phosphor-icons/vue";
import { EmptyState, MarkdownText, Modal } from "@vynel/ui";
import { useRules } from "../../composables/rules/use-rules.js";
import { useDeleteRule } from "../../composables/rules/use-delete-rule.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";
import WriteRuleDialog from "./WriteRuleDialog.vue";

// The rules a surface OWNS — the `.claude/rules/*.md` files in that folder on
// disk, the user's hand-written ones included. A global rule still LOADS in a
// workspace session; it is simply the Global menu's to show and to manage.
// The file is the record (config-is-truth): writing, editing and deleting
// here are whole-file operations on that folder. A marketplace-installed
// rule wears a "Managed by Vynel" chip (the AgentsSection SOURCE_LABELS
// idiom); editing one forks it into the user's own copy.
const props = defineProps<{
  scope: SectionScope;
}>();

const rulesQuery = useRules(() => props.scope);
const rules = computed(() => rulesQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();
const deleteRule = useDeleteRule();

function scopeChip(rowScope: "user" | "workspace"): string {
  if (rowScope === "user") return "Global";
  return props.scope.kind === "workspace"
    ? scopeLabel(props.scope.workspaceId)
    : "Workspace";
}

type RuleRow = {
  ruleId: string;
  title: string;
  content: string;
  body: string;
  scope: "user" | "workspace";
  marketplace: { ruleId: string; version: string } | null;
};

const viewingRule = ref<{ title: string; content: string } | null>(null);
const isWriteOpen = ref(false);
const editingRule = ref<{
  ruleId: string;
  content: string;
  managedByMarketplace: boolean;
} | null>(null);

function startWriting() {
  editingRule.value = null;
  isWriteOpen.value = true;
}

function startEditing(rule: RuleRow) {
  editingRule.value = {
    ruleId: rule.ruleId,
    content: rule.body,
    managedByMarketplace: rule.marketplace !== null,
  };
  isWriteOpen.value = true;
}

function onSaved() {
  isWriteOpen.value = false;
  editingRule.value = null;
}

// A rule file is gone for good once deleted — so, per the notebook's idiom,
// the X arms first ("Sure?"), only a second explicit click fires the delete,
// and losing focus disarms.
const armedDeleteId = ref<string | null>(null);

function requestDelete(rule: RuleRow) {
  if (armedDeleteId.value !== rule.ruleId) {
    armedDeleteId.value = rule.ruleId;
    return;
  }
  armedDeleteId.value = null;
  deleteRule.mutate({
    ruleId: rule.ruleId,
    scope:
      rule.scope === "workspace" && props.scope.kind === "workspace"
        ? { scope: "workspace", workspaceId: props.scope.workspaceId }
        : { scope: "user" },
  });
}

function disarmDelete(ruleId: string) {
  if (armedDeleteId.value === ruleId) armedDeleteId.value = null;
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Standing instructions Claude follows in every workspace"
    : "Standing instructions kept in this workspace",
);
</script>

<template>
  <div class="rules-section flex flex-col gap-2.5">
    <SectionHeader :icon="ScrollText" title="Rules" :subtitle="sectionHint">
      <template v-if="rules.length > 0" #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a rule
        </button>
      </template>
    </SectionHeader>

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
              <p
                class="row-title m-0 truncate text-sm font-semibold text-ink-1"
              >
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
        <button
          type="button"
          class="icon-button edit-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Edit ${rule.title}`"
          :aria-label="`Edit ${rule.title}`"
          @click="startEditing(rule)"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedDeleteId === rule.ruleId
              ? 'row-action delete-button is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button delete-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :title="
            armedDeleteId === rule.ruleId
              ? `Confirm delete ${rule.title}`
              : `Delete ${rule.title}`
          "
          :aria-label="
            armedDeleteId === rule.ruleId
              ? `Confirm delete ${rule.title}`
              : `Delete ${rule.title}`
          "
          @click="requestDelete(rule)"
          @blur="disarmDelete(rule.ruleId)"
        >
          <template v-if="armedDeleteId === rule.ruleId">Sure?</template>
          <X v-else :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No rules yet"
      hint="Rules are standing instructions Claude always follows here — write one, or install one from the Marketplace."
    >
      <template #icon>
        <ScrollText :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a rule
        </button>
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

    <WriteRuleDialog
      :open="isWriteOpen"
      :default-scope="props.scope"
      :editing="editingRule"
      @close="onSaved"
      @saved="onSaved"
    />
  </div>
</template>
