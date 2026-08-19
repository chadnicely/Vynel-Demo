<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChatComposer, type ComposerSuggestItem } from "@vynel/ui";
import { SESSION_MODES } from "@vynel/session";
import type { SessionMode } from "@vynel/session";
import {
  availableChatModelsFloor,
  formatContextWindow,
  formatVersionedModelLabel,
  groupAvailableModels,
  selectEffortOptionsForModel,
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
import { useSessionSettings } from "../../composables/chat/use-session-settings.js";
import type { ComposerSettings } from "../../composables/chat/use-session-settings.js";
import { useAvailableModels } from "../../composables/models/use-available-models.js";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useInstalledSkills } from "../../composables/skills/use-installed-skills.js";
import { useCommands } from "../../composables/commands/use-commands.js";
import { useDictation } from "../../composables/voice/use-dictation.js";
import { filesToTurnAttachments } from "../../composables/chat/turn-attachments.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";
import { useTurnReference } from "../../composables/chat/use-turn-reference.js";

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
    /** WHICH conversation this composer speaks into — the key a marked turn
     *  is stored under. More than one composer is alive at a time, so without
     *  it a mark made in one thread would ride out on another's message. */
    sessionId?: string | null | undefined;
    /** The surface's own never-set defaults (the Voice chat panel pins the
     *  voice tier) — a persisted row value still wins, and a chip change
     *  still persists onto the session row. */
    settingsDefaults?:
      | Partial<Pick<ComposerSettings, "modelId" | "thinkingEffort" | "mode">>
      | undefined;
    /** The SURFACE pins its settings (the hands-free voice thread, D2): the
     *  chips render inert and NO change is written anywhere — not to a session
     *  row, and not to the local new-chat defaults, which an unwired locked
     *  composer would otherwise quietly rewrite. The autopilot switch goes with
     *  them: a pinned surface has one way to run. */
    settingsLocked?: boolean | undefined;
    /** Why they are pinned — one quiet line above the box, so the inert chips
     *  read as deliberate rather than broken. */
    settingsLockedNote?: string | null | undefined;
  }>(),
  {
    allowAttachments: true,
    scope: () => ({ kind: "global" }) as SectionScope,
    destinationLabel: null,
    settingsLocked: false,
    settingsLockedNote: null,
  },
);

const emit = defineEmits<{
  /** The settings ride the send — what the chips SHOWED at click time is what
   *  the turn request carries (no PATCH-vs-send race). */
  send: [
    text: string,
    attachments: TurnAttachmentInput[],
    settings: ComposerSettings,
  ];
  interrupt: [];
}>();

const ui = useUiStore();

// Per-session composer settings (2026-08-17): chips read the ACTIVE session's
// persisted settings and a change PATCHes that session only; with no session
// yet, both fall back to the ui-store's localStorage new-chat defaults. This
// is what killed "change it in one chat, it changes everywhere".
const settings = useSessionSettings(
  () => props.sessionId ?? null,
  props.settingsDefaults,
  { locked: () => props.settingsLocked },
);

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
    // The engine names rows by family alone and keeps the generation in the
    // description — too long for a row, so it is folded into the name.
    label: formatVersionedModelLabel(model),
    hint: formatContextWindow(model.contextWindowTokens),
  };
}
const modelOptions = computed(() => groupedModels.value.current.map(toComposerOption));
const moreModelOptions = computed(() => groupedModels.value.more.map(toComposerOption));

const modeOptions = SESSION_MODES.map((mode) => ({
  id: mode.mode,
  label: mode.label,
}));

// Only the levels the SELECTED model actually supports (the engine reports
// them per model). Before this the picker offered all five everywhere and the
// engine quietly downgraded an unsupported pick — the chip lied.
const selectedModel = computed(() =>
  [...groupedModels.value.current, ...groupedModels.value.more].find(
    (model) => model.id === settings.values.value.modelId,
  ),
);
const effortOptions = computed(() =>
  selectEffortOptionsForModel(THINKING_EFFORT_OPTIONS, selectedModel.value),
);

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

// The turn the person marked in the thread — shown here so the pointer is
// visible from the box you are typing into, and dismissible without scrolling
// back to find the card.
const { markedFor, clearFor, applyTo: applyTurnReference } = useTurnReference();

const markedTurn = computed(() => markedFor(props.sessionId));

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
  // A marked turn rides out as the message's opening reference line, and the
  // mark is spent here — every surface that composes through this component
  // gets the pointer without wiring one of its own.
  emit(
    "send",
    applyTurnReference(props.sessionId, text),
    attachments,
    settings.values.value,
  );
}

// A message the HOST composes on the user's behalf — the blocked tool card's
// "Run it anyway" re-issue. It leaves through the same `send` as a typed
// message (the host's queue, the session's settings as the chips show them)
// and leaves the draft, a marked turn and a running dictation untouched: it
// is not what the person was typing.
function sendText(text: string) {
  emit("send", text, [], settings.values.value);
}

defineExpose({ sendText });
</script>

<template>
  <p
    v-if="props.destinationLabel"
    class="m-0 mb-1 px-1 text-[10.5px] text-[var(--ink-3)] truncate"
    data-testid="composer-destination"
  >
    → {{ props.destinationLabel }}
  </p>
  <!-- The marked turn: what this message will refer to. -->
  <p
    v-if="markedTurn"
    class="m-0 mb-1 flex items-center gap-1.5 px-1 text-[10.5px]"
    data-testid="composer-reference"
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      class="shrink-0 text-[var(--gold)]"
      aria-hidden="true"
    >
      <path
        d="M13.5 8a5.5 5.5 0 0 1-5.5 5.5H2.5V8a5.5 5.5 0 0 1 11 0Z"
        fill="currentColor"
      />
    </svg>
    <span class="truncate text-[var(--ink-2)]">
      About {{ markedTurn.author }} — “{{ markedTurn.preview }}”
    </span>
    <button
      type="button"
      class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[var(--ink-3)] hover:text-[var(--ink-1)]"
      aria-label="drop the reference"
      @click="clearFor(props.sessionId)"
    >
      ✕
    </button>
  </p>
  <!-- Why the chips are inert (a hands-free surface pins its own tier). -->
  <p
    v-if="props.settingsLockedNote"
    class="m-0 mb-1 px-1 text-[10.5px] text-[var(--ink-3)]"
    data-testid="composer-settings-locked-note"
  >
    {{ props.settingsLockedNote }}
  </p>
  <ChatComposer
    v-model:draft="draft"
    :placeholder="props.placeholder"
    :streaming="props.streaming"
    :models="modelOptions"
    :more-models="moreModelOptions"
    :model-id="settings.values.value.modelId"
    :modes="modeOptions"
    :mode-id="settings.values.value.mode"
    :efforts="effortOptions"
    :effort-id="settings.values.value.thinkingEffort"
    :settings-locked="props.settingsLocked"
    :auto-buildout="props.settingsLocked ? undefined : settings.values.value.autoBuildout"
    :context-fraction="props.contextFraction ?? null"
    :context-tooltip="props.contextTooltip ?? undefined"
    :allow-attachments="props.allowAttachments"
    :mention-suggestions="mentionSuggestions"
    :workspace-suggestions="workspaceSuggestions"
    :slash-suggestions="slashSuggestions"
    show-voice
    :voice-active="dictation.isDictating.value"
    :notice="notice"
    @update:auto-buildout="(on) => settings.update({ autoBuildout: on })"
    @update:model-id="(id) => settings.update({ modelId: id })"
    @update:mode-id="(id) => settings.update({ mode: id as SessionMode })"
    @update:effort-id="
      (id) => settings.update({ thinkingEffort: id as ComposerThinkingEffort })
    "
    @send="onSend"
    @interrupt="emit('interrupt')"
    @voice="dictation.toggle"
  />
</template>
