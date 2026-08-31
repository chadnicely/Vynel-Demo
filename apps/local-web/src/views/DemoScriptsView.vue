<script setup lang="ts">
import { computed, ref } from "vue";
import DemoVoicePicker from "../components/demo/DemoVoicePicker.vue";
import { useCurrentVoiceLabel } from "../composables/voice/use-current-voice-label.js";
import {
  DEMO_QUEUE_TARGET,
  useDemoStore,
  type DemoScript,
} from "../stores/demo-store.js";
import { fillHudSample, isFramingCategory } from "../demo/demo-script-writer.js";
import { rollTakeMetrics } from "../demo/demo-rules.js";

// The film kit — ONE page, three tabs (Chad, 2026-08-28: "super complicated",
// "give me one place", "lets have tabs"). Software is the roster and what each
// product does; Update Samples is the BANK of sentences every take is built
// from; The Take writes one and rehearses it.
//
// It renders as an ORDINARY page — the same chrome every other screen has
// (Chad, 2026-08-28). Everything is client-only (demo-store); nothing reaches
// the database.

type SettingsTab = "software" | "samples" | "rules";
type QueueTab = "ready" | "waiting" | "completed";

// The film kit is a full view with no menu, so the one setting it depends on —
// the voice models — has to be reachable from here (Chad, 2026-08-28). The
// shell owns the settings canvas, so the view asks and the shell opens it.
const emit = defineEmits<{ openVoiceSettings: [] }>();

const demo = useDemoStore();
const settingsOpen = ref(false);
const settingsTab = ref<SettingsTab>("software");
const softwareDraft = ref("");
const categoryDraft = ref("");

/** What each stage is called on screen. Approving a take starts its voice
 *  recording, so the card says so, and says when it is ready to film — the
 *  one word Chad reads before pressing Demo (2026-08-28). */
/** What a card says while you are waiting on it (Chad, 2026-08-28): Pending
 *  until Approve is pressed, then Recording the voice. A recorded take says
 *  nothing at all — being in the Ready to film tab is the statement. */
function stageLabel(script: DemoScript): string {
  const stage = demo.scriptStage(script);
  if (stage === "unread") return "Pending";
  if (stage === "recorded") return "Ready";
  const { done, total } = demo.prepareProgress;
  const progress = total > 0 ? ` (${done}/${total} lines complete)` : "";
  return `Recording the voice with ${voiceLabel.value}${progress}`;
}

// The setup screens, inside the popup. "Sample Clips" is Chad's name for the
// line bank (2026-08-29; it was "Update Samples").
const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "software", label: "Software" },
  { id: "samples", label: "Sample Clips" },
  { id: "rules", label: "Rules" },
];

/** Which half of the queue is on show: the takes that can be filmed, or the
 *  ones still waiting on a read. Split so a shooting day is not spent
 *  scrolling past nine unapproved cards. */
const queueView = ref<QueueTab>("ready");

/** Ready = RECORDED. Approved-but-still-recording belongs with the waiting,
 *  because it cannot be filmed yet (Chad: green only when a demo can play). */
/** Newest at the top, on every tab (Chad, 2026-08-30). The queue is written
 *  in one press, so insertion order put the take he just made at the bottom
 *  of ten. Takes written before `createdAt` sort last rather than first —
 *  they ARE the old ones. */
function newestFirst(list: readonly DemoScript[]): DemoScript[] {
  return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const readyScripts = computed(() =>
  newestFirst(
    demo.scripts.filter(
      (script) =>
        demo.scriptStage(script) === "recorded" && script.completedAt === undefined,
    ),
  ),
);
/** The keepers — filmed and called done. Their own tab, so Ready stays the
 *  work left (Chad, 2026-08-29). */
const completedScripts = computed(() =>
  newestFirst(demo.scripts.filter((script) => script.completedAt !== undefined)),
);
const waitingScripts = computed(() =>
  newestFirst(
    demo.scripts.filter((script) => demo.scriptStage(script) !== "recorded"),
  ),
);
/** One phrase for the tab you are on — “8 waiting”. The old row counted the
 *  takes twice in two units beside a badge counting lines, which read as a
 *  contradiction (Chad, 2026-08-30). */
const queueCount = computed(() => {
  const count = shownScripts.value.length;
  const word =
    queueView.value === "ready"
      ? "ready to film"
      : queueView.value === "completed"
        ? "completed"
        : "waiting";
  return `${count} ${word}`;
});

const shownScripts = computed(() => {
  if (queueView.value === "ready") return readyScripts.value;
  if (queueView.value === "completed") return completedScripts.value;
  return waitingScripts.value;
});

/** The card whose ⋯ menu is open; only ever one. */
const openMenu = ref<string | null>(null);

function toggleMenu(scriptId: string): void {
  openMenu.value = openMenu.value === scriptId ? null : scriptId;
}

function addSoftware(): void {
  demo.addProject(softwareDraft.value);
  softwareDraft.value = "";
}

function onPurposeEdited(projectId: string, event: Event): void {
  demo.setProjectPurpose(projectId, (event.target as HTMLInputElement).value);
}

/** Which queue cards have their lines open. Collapsed by default: ten takes
 *  of nine lines is a wall of text, and the card's job is to say whether this
 *  one is ready to film (Chad, 2026-08-28). */
const openScripts = ref(new Set<string>());

function toggleScript(scriptId: string): void {
  if (openScripts.value.has(scriptId)) {
    openScripts.value.delete(scriptId);
    return;
  }
  openScripts.value.add(scriptId);
  // Opening it IS reading it — there is nothing else to do with a take on
  // this screen (Chad, 2026-08-30).
  demo.markScriptRead(scriptId);
}

/** Which products have their shipped list open. */
const openSoftware = ref(new Set<string>());

function toggleSoftware(projectId: string): void {
  if (openSoftware.value.has(projectId)) openSoftware.value.delete(projectId);
  else openSoftware.value.add(projectId);
}

function onUpdatesEdited(projectId: string, event: Event): void {
  demo.setProjectUpdates(projectId, (event.target as HTMLTextAreaElement).value);
}

function addCategory(): void {
  demo.addCategory(categoryDraft.value);
  // A new idea opens on arrival — it is empty, and the point of adding it is
  // to type the first line.
  if (categoryDraft.value.trim().length > 0) openCategories.value.add(
    categoryDraft.value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  );
  categoryDraft.value = "";
}

/** Which idea boxes are expanded. A Set rather than a flag per category, so a
 *  category added or removed never leaves a stale open-state behind. */
const openCategories = ref(new Set<string>());

function toggleCategory(categoryId: string): void {
  if (openCategories.value.has(categoryId)) openCategories.value.delete(categoryId);
  else openCategories.value.add(categoryId);
}

function onSampleEdited(categoryId: string, index: number, event: Event): void {
  demo.updateCategorySample(
    categoryId,
    index,
    (event.target as HTMLInputElement).value,
  );
}

/** The per-category "add a line" boxes, keyed by category id. */
const sampleDrafts = ref<Record<string, string>>({});

function addSample(categoryId: string): void {
  demo.addCategorySample(categoryId, sampleDrafts.value[categoryId] ?? "");
  sampleDrafts.value[categoryId] = "";
}

// ── Rules ───────────────────────────────────────────────────────────────────
function onRulesEdited(event: Event): void {
  demo.setMetricRulesText((event.target as HTMLTextAreaElement).value);
}

/** What a HUD line sounds like once this take's numbers are in — a rule slot
 *  is hard to hear until it is filled. */
function categoryPreview(sample: string | undefined): string | null {
  if (sample === undefined) return null;
  return fillHudSample(sample, rollTakeMetrics(demo.metricRules, Math.random));
}

const voiceLabel = useCurrentVoiceLabel();

/** Film a take in a NEW BROWSER TAB (Chad, 2026-08-29: "make it a new tab so
 *  you can get back to the scripts"). Playing in place took the whole window —
 *  the room goes full-screen — so every run meant navigating back to the queue
 *  before the next one. The takes and their recorded audio live in
 *  localStorage + IndexedDB, which the new tab shares, so it can film without
 *  copying anything across. */
function filmInNewTab(scriptId: string): void {
  window.open(`${location.origin}/?play=${encodeURIComponent(scriptId)}`, "_blank");
}

/** When a take last ran — always date AND time (Chad, 2026-08-29): a reel is
 *  filmed across days, and "2:00 PM" alone cannot say which day's footage the
 *  good one is. */
function playedLabel(at: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${when.toLocaleDateString()} ${time}`;
}

const readinessLabel = computed(() => {
  switch (demo.readiness) {
    case "preparing":
      // The recording take's own badge says which voice and how far — saying it
      // twice, in two wordings, was the noise (Chad, 2026-08-29).
      return "";
    case "ready":
      return "Voice ready — the take plays instantly";
    case "failed":
      return "No voice installed yet — open Settings → Voice and download it once.";
    default:
      return "";
  }
});

/** A take's length WITH the greeting, which is what the camera actually
 *  records — the greeting is part of every video. */
function runtimeLabel(script: DemoScript): string | null {
  const seconds = demo.scriptRuntimeSeconds(script);
  return seconds === null ? null : `~${Math.round(seconds + 4)}s`;
}

async function playWholeTake(script: DemoScript): Promise<void> {
  for (const line of script.lines) await demo.playRecordedLine(line.text);
}
</script>

<template>
  <div class="film-kit" data-tauri-drag-region>
    <header class="head">
      <div>
        <h1>Demo Videos</h1>
        <p class="sub">
          List your software, keep a bank of update lines, and it writes the
          take. Then arm it and say <strong>“What's up Pacino”</strong> on
          camera.
        </p>
      </div>
      <div class="head-actions">
        <!-- WHICH voice, where the takes are (Chad, 2026-08-29) — the thing you
             re-judge on every playback, changeable without leaving for
             Settings. -->
        <DemoVoicePicker />
        <button
          type="button"
          class="primary create-scripts"
          data-testid="demo-fill-queue"
          @click="demo.fillQueue()"
        >
          Create scripts
        </button>
        <button
          type="button"
          class="quiet"
          data-testid="demo-voice-settings"
          @click="emit('openVoiceSettings')"
        >
          Voice setup
        </button>
        <button
          type="button"
          class="arm"
          :class="{ on: demo.isArmed }"
          data-testid="demo-arm-toggle"
          @click="demo.toggleArmed()"
        >
          {{ demo.isArmed ? "Ready to film — ON" : "Arm for filming" }}
        </button>
      </div>
    </header>

    <p v-if="readinessLabel" class="readiness" :class="demo.readiness">
      {{ readinessLabel }}
      <button
        v-if="demo.readiness === 'failed'"
        type="button"
        class="quiet inline-link"
        data-testid="demo-open-voice-settings"
        @click="emit('openVoiceSettings')"
      >
        Open voice setup
      </button>
      <button
        v-if="demo.readiness === 'failed'"
        type="button"
        class="quiet inline-link"
        @click="void demo.prepareAudio()"
      >
        Try again
      </button>
    </p>

    <nav class="tabs" aria-label="Queue">
      <button
        type="button"
        class="tab"
        :class="{ on: queueView === 'ready' }"
        data-testid="queue-ready"
        @click="queueView = 'ready'"
      >
        Ready ({{ readyScripts.length }})
      </button>
      <button
        type="button"
        class="tab"
        :class="{ on: queueView === 'waiting' }"
        data-testid="queue-waiting"
        @click="queueView = 'waiting'"
      >
        Waiting ({{ waitingScripts.length }})
      </button>
      <button
        type="button"
        class="tab"
        :class="{ on: queueView === 'completed' }"
        data-testid="queue-completed"
        @click="queueView = 'completed'"
      >
        Completed ({{ completedScripts.length }})
      </button>
      <span class="tab-spacer" />
      <button
        type="button"
        class="tab settings-tab"
        data-testid="open-film-settings"
        @click="settingsOpen = true"
      >
        Defaults
      </button>
    </nav>

    <!-- The setup screens, folded into one popup (Chad, 2026-08-29): filming
         works from the queue; Software / Sample Clips / Rules are how the
         takes get written, not somewhere you stand. -->
    <div
      v-if="settingsOpen"
      class="settings-pop"
      data-testid="film-settings-pop"
      @click.self="settingsOpen = false"
    >
      <div class="settings-panel" role="dialog" aria-label="Film settings">
        <header class="settings-head">
          <nav class="tabs" aria-label="Film settings">
            <button
              v-for="option in SETTINGS_TABS"
              :key="option.id"
              type="button"
              class="tab"
              :class="{ on: settingsTab === option.id }"
              :data-testid="`tab-${option.id}`"
              @click="settingsTab = option.id"
            >
              {{ option.label }}
            </button>
          </nav>
          <button
            type="button"
            class="quiet close"
            aria-label="Close settings"
            @click="settingsOpen = false"
          >
            ✕
          </button>
        </header>

    <!-- SOFTWARE — the roster, and what each product does. -->
    <section v-if="settingsTab === 'software'" class="panel">
      <p class="hint">
        Each one is a dot on the node screen. Open its
        <strong>updates</strong> box and paste what that project's Claude Code
        says it built — those lines are what the video actually speaks.
      </p>

      <ul class="software-list">
        <template v-for="project in demo.projects" :key="project.id">
          <li>
            <span class="badge">{{ project.initials }}</span>
            <span class="name">{{ project.name }}</span>
            <input
              :value="project.purpose"
              placeholder="what it does — e.g. checkout pages that convert"
              :data-testid="`purpose-${project.id}`"
              @change="onPurposeEdited(project.id, $event)"
            />
            <button
              type="button"
              class="quiet built-toggle"
              :class="{ empty: project.updates.length === 0 }"
              :aria-expanded="openSoftware.has(project.id)"
              :data-testid="`updates-toggle-${project.id}`"
              @click="toggleSoftware(project.id)"
            >
              {{ demo.updateTally(project.id).fresh }}/{{ project.updates.length }}
              fresh {{ openSoftware.has(project.id) ? "▾" : "▸" }}
            </button>
            <button
              type="button"
              class="quiet"
              title="Remove"
              @click="demo.removeProject(project.id)"
            >
              ✕
            </button>
          </li>
          <li v-if="openSoftware.has(project.id)" class="built-row">
            <p class="hint">
              {{ project.name }}'s update box — ask that project's Claude Code
              what it built and paste the answer here, one update per line
              (bullets and numbering are fine). These are spoken as written, and
              each one lights {{ project.name }} on the node screen.
            </p>
            <textarea
              rows="5"
              :value="project.updates.join('\n')"
              placeholder="the one-click upsell flow is live&#10;we rebuilt the affiliate dashboard&#10;mobile checkout ships tomorrow"
              :data-testid="`updates-${project.id}`"
              @change="onUpdatesEdited(project.id, $event)"
            />
          </li>
        </template>
      </ul>

      <div class="add-row">
        <input
          v-model="softwareDraft"
          placeholder="Add software — e.g. Course Sprout"
          data-testid="demo-add-software"
          @keyup.enter="addSoftware"
        />
        <button type="button" @click="addSoftware">Add</button>
        <button
          type="button"
          class="quiet"
          title="Fill any empty update box with the built-in list"
          data-testid="demo-load-builtin"
          @click="demo.loadBuiltInSoftware()"
        >
          Load built-in updates
        </button>
        <button
          type="button"
          class="quiet"
          title="Every update becomes sayable again"
          @click="demo.clearUsedUpdates()"
        >
          Reset used
        </button>
      </div>
    </section>

    <!-- UPDATE SAMPLES — the bank, filed under top-level ideas. -->
    <section v-if="settingsTab === 'samples'" class="panel">
      <p class="hint">
        This is the <strong>HUD talking</strong> — the assistant's own voice
        between the software updates, played on the orb. Don't name software
        here; that comes from each product's own update box. Rule slots work —
        write <code>{leads}</code> and it rolls a number. One idea per box, one
        line each; a take pulls from different ideas.
      </p>

      <p class="hint framing-note">
        <strong>Into the dev updates</strong> and <strong>Conclusion</strong> are
        the take's bookends — the assistant speaks one of each around the
        script, so they never appear in the script text. Edit them here.
      </p>

      <div
        v-for="category in demo.updateCategories"
        :key="category.id"
        class="category"
        :class="{ framing: isFramingCategory(category.id) }"
      >
        <header class="category-head">
          <button
            type="button"
            class="disclose"
            :aria-expanded="openCategories.has(category.id)"
            :data-testid="`category-${category.id}`"
            @click="toggleCategory(category.id)"
          >
            <span class="caret">{{
              openCategories.has(category.id) ? "▾" : "▸"
            }}</span>
            {{ category.label }}
          </button>
          <span class="chip">{{ category.samples.length }} lines</span>
          <button
            type="button"
            class="quiet"
            title="Remove"
            @click="demo.removeCategory(category.id)"
          >
            ✕
          </button>
        </header>

        <template v-if="openCategories.has(category.id)">
          <ul class="sample-list">
            <li v-for="(sample, index) in category.samples" :key="index">
              <button
                type="button"
                class="star"
                :class="{ on: demo.isStarred(sample) }"
                :aria-pressed="demo.isStarred(sample)"
                :title="
                  demo.isStarred(sample)
                    ? 'Said in every video — click to unstar'
                    : 'Star: say this in every video'
                "
                :data-testid="`star-${category.id}-${index}`"
                @click="demo.toggleStarredSample(sample)"
              >
                {{ demo.isStarred(sample) ? "★" : "☆" }}
              </button>
              <input
                :value="sample"
                :data-testid="`sample-${category.id}-${index}`"
                @change="onSampleEdited(category.id, index, $event)"
              />
              <button
                type="button"
                class="quiet"
                title="Remove"
                @click="demo.removeCategorySample(category.id, index)"
              >
                ✕
              </button>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="sampleDrafts[category.id]"
              placeholder="{name} — four hundred new leads this week."
              :data-testid="`add-sample-${category.id}`"
              @keyup.enter="addSample(category.id)"
            />
            <button type="button" @click="addSample(category.id)">Add line</button>
          </div>
          <p v-if="categoryPreview(category.samples[0])" class="preview">
            Sounds like: “{{ categoryPreview(category.samples[0]) }}”
          </p>
        </template>
      </div>

      <div class="add-row">
        <input
          v-model="categoryDraft"
          placeholder="New top level — e.g. Partnerships"
          data-testid="demo-add-category"
          @keyup.enter="addCategory"
        />
        <button type="button" @click="addCategory">Add</button>
        <button type="button" class="quiet" @click="demo.restoreDefaultSamples()">
          Restore built-ins
        </button>
      </div>
    </section>

    <!-- RULES — what a number is allowed to be when a take speaks one. -->
    <section v-if="settingsTab === 'rules'" class="panel">
      <p class="hint">
        One rule per line, the way you'd say it —
        <code>leads: 300-1200</code> or <code>sales: $434-2340</code>. Put a
        dollar sign on money. Every video picks one number inside each range and
        sticks to it for the whole video, so it never contradicts itself.
      </p>

      <textarea
        class="bank"
        rows="8"
        :value="demo.metricRulesText"
        placeholder="leads: 300-1200&#10;sales: $434-2340&#10;quiz submissions: up to 600"
        data-testid="demo-rules-text"
        @change="onRulesEdited"
      />

      <p v-if="demo.unreadableRuleLines.length > 0" class="unreadable">
        Couldn't read
        {{ demo.unreadableRuleLines.length === 1 ? "this line" : "these lines" }},
        so
        {{ demo.unreadableRuleLines.length === 1 ? "it was" : "they were" }}
        skipped — write them like <code>name: 300-1200</code>:
        <span v-for="line in demo.unreadableRuleLines" :key="line" class="bad-line">{{
          line
        }}</span>
      </p>

      <button type="button" class="quiet" @click="demo.restoreDefaultRules()">
        Restore built-in rules
      </button>

      <h3 class="sub-head">In every video</h3>
      <p class="hint">
        Star a line over in <strong>Update Samples</strong> and it's said in
        every video — star the sales line and the leads line and you always tell
        both.
        <template v-if="demo.orderedStarred.length > 0">
          Starred right now:
        </template>
      </p>
      <ul v-if="demo.orderedStarred.length > 0" class="starred-list">
        <li v-for="sample in demo.orderedStarred" :key="sample">★ {{ sample }}</li>
      </ul>

      <p class="hint always-software">
        Software that must appear in every video, whatever the shuffle draws:
      </p>
      <div class="chip-row">
        <button
          v-for="project in demo.projects"
          :key="project.id"
          type="button"
          class="pick-chip"
          :class="{ on: demo.alwaysProjectIds.includes(project.id) }"
          :aria-pressed="demo.alwaysProjectIds.includes(project.id)"
          :data-testid="`always-project-${project.id}`"
          @click="demo.toggleAlwaysProject(project.id)"
        >
          {{ project.name }}
        </button>
      </div>
    </section>

      </div>
    </div>

    <!-- THE QUEUE — the page itself. -->
    <section class="panel">
      <div class="take-row">
        <span class="counts">{{ queueCount }}</span>
        <span class="spacer" />
        <!-- Only where it applies: approving is the Waiting tab's job, and on
             Ready it is a button with nothing left to do (Chad, 2026-08-28). -->
        <button
          v-if="queueView === 'waiting' && demo.pendingScripts.length > 0"
          type="button"
          class="quiet-action"
          data-testid="demo-approve-all"
          title="Approve every take and record all the voices in one pass"
          @click="demo.approveAll()"
        >
          Approve all
        </button>
        <button
          v-if="queueView === 'waiting' && demo.approvedScripts.length > 0"
          type="button"
          class="quiet-action"
          data-testid="demo-unapprove-all"
          title="Send every take back for a read"
          @click="demo.unapproveAll()"
        >
          Unapprove all
        </button>
      </div>

      <ol v-if="shownScripts.length > 0" class="queue">
        <li
          v-for="script in shownScripts"
          :key="script.id"
          :class="{ played: script.playedAt !== undefined }"
        >
          <header class="queue-head">
            <!-- Every stage wears its word, recorded included (Chad,
                 2026-08-29): a blank badge beside labelled ones reads as
                 unfinished rather than as done. -->
            <span
              class="status"
              :class="demo.scriptStage(script)"
              :data-testid="`status-${script.id}`"
            >
              <span
                v-if="demo.scriptStage(script) === 'recording'"
                class="spinner"
                aria-hidden="true"
              />
              {{ stageLabel(script) }}
            </span>
            <span
              v-if="script.readAt !== undefined"
              class="read-mark"
              :title="`Read ${playedLabel(script.readAt)}`"
              :data-testid="`read-${script.id}`"
            >
              ✓ Read
            </span>
            <span class="spacer" />
            <span v-if="runtimeLabel(script)" class="runtime">{{
              runtimeLabel(script)
            }}</span>
            <!-- The same number the film slate showed on camera — how footage
                 on disk is matched back to its take (Chad, 2026-08-29). -->
            <span v-if="script.clipNumber !== undefined" class="clip-number">
              Clip #{{ script.clipNumber }}
            </span>
            <span v-if="script.playedAt !== undefined" class="played-at">
              Played {{ playedLabel(script.playedAt) }}
            </span>
            <button
              v-if="demo.scriptStage(script) === 'recorded'"
              type="button"
              class="quiet-action"
              :title="
                script.playedAt === undefined
                  ? 'Play the whole thing — HUD, then the node screen'
                  : 'Play this take again'
              "
              :data-testid="`demo-${script.id}`"
              @click="filmInNewTab(script.id)"
            >
              {{ script.playedAt === undefined ? "▶ Demo" : "↻ Replay" }}
            </button>
            <button
              v-if="
                demo.scriptStage(script) === 'recorded' &&
                script.playedAt !== undefined &&
                script.completedAt === undefined
              "
              type="button"
              class="quiet-action"
              title="This one's the keeper — stop counting it as work left"
              :data-testid="`complete-${script.id}`"
              @click="demo.markComplete(script.id)"
            >
              ✓ Mark Complete
            </button>
            <button
              v-if="script.completedAt !== undefined"
              type="button"
              class="quiet-action complete-mark"
              title="Completed — click to put it back in the rotation"
              :data-testid="`uncomplete-${script.id}`"
              @click="demo.unmarkComplete(script.id)"
            >
              ✓ Complete
            </button>
            <!-- ONE button, one word (Chad, 2026-08-28). Approve sits where
                 Demo sits, so the eye lands in the same place on either tab,
                 and it stays "Approve" whether the take has never been read or
                 was approved with its voice still missing — both times it does
                 the same thing: approve, record, move to Ready. Quiet, because
                 the loud button on this screen is the one that plays a take. -->
            <button
              v-if="demo.scriptStage(script) !== 'recorded'"
              type="button"
              class="quiet-action"
              :class="{ cancelling: demo.scriptStage(script) === 'recording' }"
              :data-testid="
                demo.scriptStage(script) === 'recording'
                  ? `cancel-${script.id}`
                  : `approve-${script.id}`
              "
              @click="
                demo.scriptStage(script) === 'recording'
                  ? demo.cancelPrepare()
                  : demo.approveScript(script.id)
              "
            >
              {{ demo.scriptStage(script) === "recording" ? "Cancel" : "Approve" }}
            </button>

            <!-- Everything else lives behind the dots: three buttons per card
                 across ten cards was the clutter (Chad, 2026-08-28). -->
            <div class="menu-wrap">
              <button
                type="button"
                class="quiet dots"
                title="More"
                :aria-expanded="openMenu === script.id"
                :data-testid="`menu-${script.id}`"
                @click="toggleMenu(script.id)"
              >
                ⋯
              </button>
              <div v-if="openMenu === script.id" class="menu">
                <button
                  type="button"
                  @click="openMenu = null; void playWholeTake(script)"
                >
                  Hear it
                </button>
                <button
                  v-if="script.readAt !== undefined"
                  type="button"
                  :data-testid="`unread-${script.id}`"
                  @click="openMenu = null; demo.markScriptUnread(script.id)"
                >
                  Mark unread
                </button>
                <button
                  v-if="script.status === 'approved'"
                  type="button"
                  @click="openMenu = null; demo.unapproveScript(script.id)"
                >
                  Unapprove
                </button>
                <button
                  type="button"
                  @click="openMenu = null; demo.rerollScript(script.id)"
                >
                  Write a different one
                </button>
                <button
                  type="button"
                  class="danger"
                  @click="openMenu = null; demo.removeScript(script.id)"
                >
                  Delete
                </button>
              </div>
            </div>
          </header>
          <button
            type="button"
            class="quiet script-toggle"
            :aria-expanded="openScripts.has(script.id)"
            :data-testid="`lines-toggle-${script.id}`"
            @click="toggleScript(script.id)"
          >
            {{ openScripts.has(script.id) ? "▾" : "▸" }}
            {{ script.lines.length }} lines · {{ script.title }}
          </button>

          <ul v-if="openScripts.has(script.id)" class="lines">
            <li v-for="(line, index) in script.lines" :key="index">
              <button
                type="button"
                class="quiet line-play"
                title="Hear this line"
                @click="void demo.playRecordedLine(line.text)"
              >
                ▶
              </button>
              <span class="surface" :class="line.surface">{{
                line.surface === "hud" ? "HUD" : "NODES"
              }}</span>
              <span>{{ line.text }}</span>
            </li>
          </ul>
        </li>
      </ol>

      <p v-else-if="demo.scripts.length === 0" class="hint">
        Nothing written yet — press <strong>Create scripts</strong> and it
        writes {{ DEMO_QUEUE_TARGET }} takes from your software, samples and
        rules.
      </p>
      <p v-else-if="queueView === 'ready'" class="hint">
        Nothing is recorded yet. Press <strong>Approve all</strong> and the
        voices record in one pass — each take moves here as it finishes.
      </p>
      <p v-else-if="queueView === 'completed'" class="hint">
        Nothing filmed and marked done yet — after a take plays, press
        <strong>✓ Mark Complete</strong> on it and it lands here.
      </p>
      <p v-else class="hint">
        Nothing waiting — every take is recorded and ready to film.
      </p>
    </section>
  </div>
</template>

<style scoped>
.film-kit {
  height: 100%;
  overflow-y: auto;
  padding: 34px 40px 60px;
  max-width: 840px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
h1 {
  margin: 0 0 5px;
  font: 600 22px var(--font-ui);
  color: var(--ink-1);
}
.sub {
  margin: 0;
  color: var(--ink-2);
  font: 400 13px/1.55 var(--font-ui);
}
.head-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.inline-link {
  margin-left: 8px;
  text-decoration: underline;
  color: inherit;
}
.arm {
  flex-shrink: 0;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  background: transparent;
  color: var(--ink-2);
  font: 600 12.5px var(--font-ui);
  cursor: pointer;
}
.arm.on {
  border-color: var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
}
.readiness {
  margin: 14px 0 0;
  font: 500 12px var(--font-ui);
  color: var(--ink-2);
}
.readiness.failed {
  color: #ef4444;
}
.tabs {
  margin-top: 22px;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--hair);
}
.tab {
  appearance: none;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-3);
  font: 600 13px var(--font-ui);
  padding: 9px 14px;
  cursor: pointer;
}
.tab:hover {
  color: var(--ink-1);
}
.tab.on {
  color: var(--ink-1);
  border-bottom-color: var(--gold);
}
.panel {
  margin-top: 18px;
  padding: 18px 20px;
  border: 1px solid var(--hair);
  border-radius: 12px;
}
.hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
}
code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--gold-soft);
  color: var(--ink-1);
  font-size: 11.5px;
}
.software-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.software-list li {
  display: grid;
  grid-template-columns: auto 150px 1fr auto auto;
  align-items: center;
  gap: 10px;
}
.software-list li.built-row {
  display: block;
  margin: -2px 0 8px 36px;
  padding: 10px 12px;
  border: 1px solid var(--hair);
  border-radius: 8px;
}
.built-row .hint {
  margin-bottom: 8px;
}
.built-toggle {
  white-space: nowrap;
  color: var(--ink-3);
  font: 500 11px var(--font-ui);
}
.badge {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid var(--hair);
  color: var(--ink-2);
  font: 600 10.5px var(--font-ui);
}
.name {
  color: var(--ink-1);
  font: 500 13px var(--font-ui);
}
input,
textarea {
  width: 100%;
  padding: 8px 11px;
  border: 1px solid var(--hair);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-1);
  font: 400 13px/1.6 var(--font-ui);
}
textarea {
  resize: vertical;
}
.category {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--hair);
}
/* The bookends read as their own thing — they frame a take rather than
   supplying its content, and a star on one would mean nothing. */
.category.framing .disclose {
  color: var(--gold);
}
.framing-note {
  margin-top: 12px;
}
.category-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.disclose {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  padding: 4px 0;
  background: transparent;
  color: var(--ink-1);
  font: 600 13px var(--font-ui);
  text-align: left;
}
.caret {
  color: var(--ink-3);
  font-size: 10px;
}
.sample-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.sample-list li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
}
.star {
  border: none;
  padding: 2px 4px;
  background: transparent;
  color: var(--ink-3);
  font-size: 15px;
  line-height: 1;
}
.star.on {
  color: var(--gold);
}
.chip {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  font: 500 10.5px var(--font-ui);
}
button {
  cursor: pointer;
  border: 1px solid var(--hair);
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font: 500 12.5px var(--font-ui);
  padding: 8px 14px;
}
button.primary {
  border-color: var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
}
button.quiet {
  border: none;
  padding: 4px 8px;
}
.add-row {
  margin-top: 14px;
  display: flex;
  gap: 8px;
}
.preview {
  margin: 8px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  font-style: italic;
}
.unreadable {
  margin: 10px 0 0;
  color: #ef4444;
  font: 500 12px/1.6 var(--font-ui);
}
.bad-line {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 5px;
  border: 1px dashed currentColor;
  font-family: var(--font-mono, monospace);
}
textarea.bank {
  margin-top: 14px;
  margin-bottom: 6px;
  font-family: var(--font-mono, monospace);
}
.range {
  color: var(--ink-3);
  font: 400 11.5px var(--font-ui);
  font-style: italic;
}
.take-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.runtime {
  color: var(--ink-2);
  font: 600 12px var(--font-ui);
}
.lines {
  margin: 10px 0 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  color: var(--ink-2);
  font: 400 13px/1.5 var(--font-ui);
}
.counts {
  color: var(--ink-3);
  font: 400 12px var(--font-ui);
}
.counts strong {
  color: var(--ink-1);
}
.queue > li.played .queue-head,
.queue > li.played .lines {
  opacity: 0.55;
}

/* Stopping is not a quiet action — it is the one you want to find fast. */
.quiet-action.cancelling {
  color: var(--danger);
  border-color: var(--danger);
}

/* Ready is the good state — it wears the accent rather than the quiet grey
   the waiting states use. */
.tab-spacer {
  flex: 1;
}

.settings-pop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 55%);
}

.settings-panel {
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 12px 18px 18px;
  border: 1px solid var(--hair-strong);
  border-radius: 8px;
  background: var(--bg-shell);
  box-shadow: 0 18px 50px rgb(0 0 0 / 55%);
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

/* Sits in the tab row, so it keeps the row's rhythm rather than the panel's. */
.tabs .create-scripts {
  margin-left: 10px;
  padding: 5px 12px;
}

.settings-head .close {
  padding: 4px 8px;
  font-size: 13px;
}

.quiet-action.complete-mark {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  color: var(--color-accent);
}

.status.recorded {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  color: var(--color-accent);
}

.played-at {
  margin-left: 8px;
  color: var(--ink-3);
  font-size: 10px;
  white-space: nowrap;
}

/* Read: quiet on purpose. It marks the ones he can skip past, so it must not
   compete with the stage badge that says what a take still needs. */
.read-mark {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* The clip number is the take's on-camera identity — a touch louder than the
   played time beside it. */
.clip-number {
  margin-left: 8px;
  color: var(--ink-2);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.queue {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.queue > li {
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: 10px;
}
/* No highlight on a ready card: the tab it sits in already says so (Chad,
   2026-08-28), and ten green cards is just a green screen. */
.queue-tabs {
  margin-top: 14px;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--hair);
}
.menu-wrap {
  position: relative;
}
/* The quiet counterpart to ▶ Demo: same slot, smaller and grey, because
   approving is a step on the way rather than the thing this screen is for. */
.quiet-action {
  padding: 5px 11px;
  border-color: var(--hair);
  background: transparent;
  color: var(--ink-3);
  font: 500 11.5px var(--font-ui);
}
.quiet-action:hover {
  color: var(--ink-1);
  border-color: var(--ink-3);
}
.dots {
  padding: 4px 8px;
  font-size: 15px;
  line-height: 1;
}
.menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 5;
  margin-top: 4px;
  min-width: 168px;
  display: grid;
  padding: 4px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: var(--panel, #1c1e2a);
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}
.menu button {
  border: none;
  border-radius: 6px;
  padding: 7px 10px;
  text-align: left;
  background: transparent;
  color: var(--ink-1);
  font: 500 12.5px var(--font-ui);
}
.menu button:hover {
  background: color-mix(in srgb, var(--ink-1) 10%, transparent);
}
.menu button.danger {
  color: #ef4444;
}
.script-toggle {
  margin-top: 10px;
  padding: 4px 0;
  color: var(--ink-3);
  font: 500 11.5px var(--font-ui);
}
.script-toggle:hover {
  color: var(--ink-1);
}
.queue-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.status {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  font: 600 10.5px var(--font-ui);
}
.status.recording {
  border-color: var(--ink-3);
  color: var(--ink-2);
}
/* The one place the kit spins: a take whose voice is being made right now.
   Everything else it does is instant, so a spinner anywhere else would be
   telling the user to wait for nothing. */
.spinner {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  vertical-align: -1px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}
.next-pill {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--gold-soft);
  border: 1px solid var(--gold);
  color: var(--ink-1);
  font: 600 10.5px var(--font-ui);
}
.queue .lines {
  list-style: none;
  padding-left: 0;
}
.queue .lines li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: baseline;
  gap: 6px;
}
.line-play {
  padding: 0 4px;
  color: var(--ink-3);
  font-size: 11px;
}
.line-play:hover {
  color: var(--gold);
}
.surface {
  display: inline-block;
  min-width: 48px;
  margin-right: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--hair);
  color: var(--ink-3);
  font: 600 9.5px var(--font-ui);
  letter-spacing: 0.06em;
  text-align: center;
  vertical-align: 1px;
}
.surface.nodes {
  border-color: var(--gold);
  color: var(--ink-1);
}
.built-toggle.empty {
  color: #ef4444;
}
.sub-head {
  margin: 24px 0 0;
  padding-top: 18px;
  border-top: 1px solid var(--hair);
  font: 600 13px var(--font-ui);
  color: var(--ink-1);
}
.always-software {
  margin-top: 18px;
}
.chip-row {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pick-chip {
  padding: 5px 12px;
  border-radius: 999px;
  font: 500 12px var(--font-ui);
}
.pick-chip.on {
  border-color: var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
}
</style>
