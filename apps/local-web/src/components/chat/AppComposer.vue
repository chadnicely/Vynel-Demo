<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChatComposer, type ComposerSuggestItem } from "@vynel/ui";
import { SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import {
  availableChatModelsFloor,
  formatContextWindow,
  groupAvailableModels,
  type AvailableChatModel,
} from "@vynel/contracts/chat/available-models";
import { THINKING_EFFORT_OPTIONS } from "@vynel/contracts/chat/thinking-effort";
import {
  buildMentionSuggestions,
  buildSlashSuggestions,
  buildWorkspaceSuggestions,
  selectOtherWorkspaces,
} from "./composer-suggestion-rosters.js";
import type { SectionScope } from "../sections/section-scope.js";
import { useUiStore } from "../../stores/ui-store.js";
import type { ComposerThinkingEffort } from "../../stores/ui-store.js";
import { useAvailableModels } from "../../composables/models/use-available-models.js";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useCommands } from "../../composables/commands/use-commands.js";
import { useDictation } from "../../composables/voice/use-dictation.js";
import { filesToTurnAttachments } from "../../composables/chat/turn-attachments.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";

// The app-bound composer: binds the shared ChatComposer to Vynel state — the
// real curated model allowlist + session-mode vocabulary, the shared composer
// selections, and the mention-picker rosters (@ agents+personas, # workspaces,
// / skills+commands — scope-aware via the host's `scope`). The composer mic
// DICTATES (speech types into the draft); talking with the assistant is the
// top-bar mic → voice overlay. Picked/pasted files are encoded + validated
// here, so the views receive wire-ready attachments.
const props = withDefaults(
  defineProps<{
    streaming?: boolean | undefined;
    placeholder?: string | undefined;
    /** The active session's context occupancy 0..1 — null hides the ring. */
    contextFraction?: number | null | undefined;
    contextTooltip?: string | null | undefined;
    /** False for surfaces whose turn route takes text only (session threads) —
     *  the attach affordance disappears instead of eating a typed message.
     *  Defaults TRUE explicitly (boolean-absent casting would strip it). */
    allowAttachments?: boolean | undefined;
    /** The chat surface's scope — picks the mention rosters (workspace chats
     *  see their workspace's agents ∪ user scope + workspace skills/commands).
     *  Defaults to the global surface. */
    scope?: SectionScope | undefined;
    /** Who this composer speaks TO, when it isn't the surface's own assistant
     *  (a session pane's persona — B8). Renders a quiet "→ Name" line; null
     *  hides it. */
    destinationLabel?: string | null | undefined;
  }>(),
  {
    allowAttachments: true,
    scope: () => ({ kind: "global" }) as SectionScope,
    destinationLabel: null,
  },
);

const emit = defineEmits<{
  send: [text: string, attachments: TurnAttachmentInput[]];
  interrupt: [];
}>();

const ui = useUiStore();

const draft = ref("");
const dictation = useDictation(draft);
const attachmentNotice = ref<string | null>(null);

// One-shot seed from another surface (the browser view's "Ask Claude" note):
// lands IN the draft for the user to review — never auto-sends. Appends
// below anything already typed, and clears so it seeds exactly once.
watch(
  () => ui.composerSeed,
  (seed) => {
    if (seed === null) return;
    draft.value = draft.value === "" ? seed : `${draft.value}\n${seed}`;
    ui.composerSeed = null;
  },
  { immediate: true },
);

// The model picker: the engine-discovered roster (current generation first,
// older behind "More models"), each row annotated with its context window;
// the contracts' static floor until the first discovery lands.
const availableModelsQuery = useAvailableModels();
const groupedModels = computed(() =>
  groupAvailableModels(
    availableModelsQuery.data.value?.models ?? availableChatModelsFloor(),
  ),
);
function toComposerOption(model: AvailableChatModel) {
  return {
    id: model.id,
    label: model.label,
    hint: formatContextWindow(model.contextWindowTokens),
  };
}
const modelOptions = computed(() => groupedModels.value.current.map(toComposerOption));
const moreModelOptions = computed(() => groupedModels.value.more.map(toComposerOption));

const modeOptions = SESSION_MODES.map((mode) => ({
  id: mode.mode,
  label: mode.label,
}));

const effortOptions = [...THINKING_EFFORT_OPTIONS];

// ── Mention-picker rosters (chat-mentions) ──────────────────────────
// The insert tokens come from the contracts grammar's format helpers, so what
// the picker writes is exactly what the server re-parses. The server resolves
// against real rows regardless — these rosters are UX, never authority.
// RESOLVED, not owned: a picker must offer everything this chat can actually
// reach, which includes the user-level agents/skills/commands a session here
// inherits. The menus ask the other question — what the scope owns — and read
// the same composables without this flag.
const scope = computed<SectionScope>(() => props.scope);
const agentsQuery = useAgents(scope, { resolved: true });
const workspacesQuery = useWorkspaceList();
const skillsQuery = useInstalledSkills(scope, { resolved: true });
const commandsQuery = useCommands(scope, { resolved: true });

const currentWorkspaceId = computed(() =>
  props.scope.kind === "workspace" ? props.scope.workspaceId : null,
);

const otherWorkspaces = computed(() =>
  selectOtherWorkspaces(workspacesQuery.data.value ?? [], currentWorkspaceId.value),
);

const mentionSuggestions = computed<ComposerSuggestItem[]>(() =>
  buildMentionSuggestions(agentsQuery.data.value ?? [], otherWorkspaces.value),
);

const workspaceSuggestions = computed<ComposerSuggestItem[]>(() =>
  buildWorkspaceSuggestions(otherWorkspaces.value),
);

const slashSuggestions = computed<ComposerSuggestItem[]>(() =>
  buildSlashSuggestions(commandsQuery.data.value ?? [], skillsQuery.data.value ?? []),
);

const notice = computed(
  () => attachmentNotice.value ?? dictation.error.value ?? undefined,
);

async function onSend(text: string, files: File[]) {
  // A send mid-dictation must not resurrect late words into the cleared box.
  dictation.cancel();
  let attachments;
  try {
    const converted = await filesToTurnAttachments(files);
    attachments = converted.attachments;
    attachmentNotice.value =
      converted.rejectedNames.length > 0
        ? `Couldn't attach ${converted.rejectedNames.join(", ")} — unsupported type, larger than 5 MB, or past the 6-file limit.`
        : null;
  } catch (readError) {
    // A failed disk read must be SAID, not swallowed into the void hook.
    attachmentNotice.value =
      readError instanceof Error
        ? readError.message
        : "One of the files couldn't be read — try attaching it again.";
    return;
  }
  // Everything the person tried to send was rejected — keep the notice, send nothing.
  if (text.trim().length === 0 && attachments.length === 0) return;
  emit("send", text, attachments);
}
</script>

<template>
  <p
    v-if="props.destinationLabel"
    class="m-0 mb-1 px-1 text-[10.5px] text-[var(--ink-3)] truncate"
    data-testid="composer-destination"
  >
    → {{ props.destinationLabel }}
  </p>
  <ChatComposer
    v-model:draft="draft"
    :placeholder="props.placeholder"
    :streaming="props.streaming"
    :models="modelOptions"
    :more-models="moreModelOptions"
    :model-id="ui.composerModelId"
    :modes="modeOptions"
    :mode-id="ui.composerMode"
    :efforts="effortOptions"
    :effort-id="ui.composerThinkingEffort"
    :context-fraction="props.contextFraction ?? null"
    :context-tooltip="props.contextTooltip ?? undefined"
    :allow-attachments="props.allowAttachments"
    :mention-suggestions="mentionSuggestions"
    :workspace-suggestions="workspaceSuggestions"
    :slash-suggestions="slashSuggestions"
    show-voice
    :voice-active="dictation.isDictating.value"
    :notice="notice"
    @update:model-id="(id) => (ui.composerModelId = id)"
    @update:mode-id="(id) => (ui.composerMode = id as SessionMode)"
    @update:effort-id="
      (id) => (ui.composerThinkingEffort = id as ComposerThinkingEffort)
    "
    @send="onSend"
    @interrupt="emit('interrupt')"
    @voice="dictation.toggle"
  />
</template>
