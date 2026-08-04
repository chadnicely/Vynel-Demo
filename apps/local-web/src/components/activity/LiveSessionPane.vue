<script setup lang="ts">
import { computed } from "vue";
import SessionThreadView from "../sessions/SessionThreadView.vue";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import { resolveChainHead } from "../../composables/sessions/resolve-chain-head.js";
import { sessionOpenAffordance } from "../../composables/sessions/session-open-affordance.js";

// The monitor panel's SESSION node body (persona-sessions B6): the real
// conversation — settled rows, the live overlay, and a composer that speaks
// INTO the running session — replacing the bare entries list. A THIN wrapper:
// the thread machinery is SessionThreadView's; this resolves the node's id
// against the overview for scope (→ the direct-send rule) and title, and
// stays honest while the overview loads (view-only, no note).
const props = defineProps<{ sessionId: string; title: string }>();

const overviewQuery = useSessionsOverview(true);
const entry = computed(
  () =>
    resolveChainHead(overviewQuery.data.value ?? [], props.sessionId)?.entry ??
    null,
);
const affordance = computed(() =>
  entry.value === null
    ? { chattable: false, viewOnlyNote: null }
    : sessionOpenAffordance(entry.value.scope),
);
</script>

<template>
  <SessionThreadView
    :session-id="props.sessionId"
    :title="entry?.title ?? props.title"
    :chattable="affordance.chattable"
    :view-only-note="affordance.viewOnlyNote"
    :follow-chain="true"
  />
</template>
