<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import {
  useCreateAgent,
  useUpdateAgent,
} from "../../composables/agents/use-agent-mutations.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { slugifyRuleName } from "./rule-name-slug.js";
import type { SectionScope } from "./section-scope.js";

// Build (or edit) a Vynel agent — a specialist Claude can delegate to. Four
// parts a person can fill without knowing the file format: the name (the
// slug is derived and fixed after creation), what it is for (the trigger —
// when Claude should hand work to it), its instructions, and, optionally,
// the tools it may use and a model. The engine keeps the row AND writes
// the `.claude/agents/<slug>.md` mirror, so the agent is visible on disk.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
  /** An agent to edit; null/absent = build a new one. */
  editing?: {
    id: string;
    slug: string;
    name: string;
    description: string;
    prompt: string;
    model: string | null;
    allowedTools: string[] | null;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const name = ref("");
const description = ref("");
const prompt = ref("");
const model = ref("");
const tools = ref("");

const createAgent = useCreateAgent();
const updateAgent = useUpdateAgent();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.editing?.name ?? "";
    description.value = props.editing?.description ?? "";
    prompt.value = props.editing?.prompt ?? "";
    model.value = props.editing?.model ?? "";
    tools.value = props.editing?.allowedTools?.join(", ") ?? "";
    createAgent.reset();
    updateAgent.reset();
  },
  { immediate: true },
);

const slug = computed(() =>
  props.editing ? props.editing.slug : slugifyRuleName(name.value),
);

const isPending = computed(
  () => createAgent.isPending.value || updateAgent.isPending.value,
);

const canSubmit = computed(
  () =>
    slug.value.length > 0 &&
    name.value.trim().length > 0 &&
    description.value.trim().length > 0 &&
    prompt.value.trim().length > 0 &&
    !isPending.value,
);

const errorMessage = computed(() => {
  const error = props.editing ? updateAgent.error.value : createAgent.error.value;
  return error ? formatSdkError(error) : null;
});

function parsedTools(): string[] | null {
  const list = tools.value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return list.length > 0 ? list : null;
}

function submit() {
  if (!canSubmit.value) return;
  const persona = {
    name: name.value.trim(),
    description: description.value.trim(),
    prompt: prompt.value,
  };
  const modelValue = model.value.trim();
  const allowedTools = parsedTools();
  if (props.editing) {
    // PATCH: null clears a field (back to "inherit" / "every tool").
    updateAgent.mutate(
      {
        agentId: props.editing.id,
        body: { ...persona, model: modelValue || null, allowedTools },
      },
      { onSuccess: () => emit("saved") },
    );
    return;
  }
  // POST: an optional field is simply absent.
  createAgent.mutate(
    {
      slug: slug.value,
      ...persona,
      ...(modelValue ? { model: modelValue } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(props.defaultScope.kind === "workspace"
        ? { scope: "workspace", workspaceId: props.defaultScope.workspaceId }
        : { scope: "user" }),
    },
    { onSuccess: () => emit("saved") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.editing ? 'Edit agent' : 'Build an agent'"
    description="A specialist Claude can hand work to — give it a job, and say when to use it."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          autofocus
          placeholder="e.g. Research assistant"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
        <span v-if="slug" class="text-[11px] text-ink-3"
          >Called as <span class="font-mono">@{{ slug }}</span
          ><template v-if="!props.editing"> · saved as <span class="font-mono">{{ slug }}.md</span></template></span
        >
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">When to use it</span>
        <input
          v-model="description"
          type="text"
          maxlength="2000"
          placeholder="One line — e.g. Use for background research before a decision"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Instructions</span>
        <textarea
          v-model="prompt"
          rows="9"
          placeholder="How it should work, in plain words. This is its system prompt."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2"
            >Tools <span class="font-normal text-ink-3">(optional)</span></span
          >
          <input
            v-model="tools"
            type="text"
            placeholder="Read, Grep, WebSearch"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2"
            >Model <span class="font-normal text-ink-3">(optional)</span></span
          >
          <input
            v-model="model"
            type="text"
            placeholder="inherit"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 font-mono text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
      </div>

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
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ isPending ? "Saving…" : "Save agent" }}
      </button>
    </template>
  </Modal>
</template>
