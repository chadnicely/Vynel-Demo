<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhCheck as Check,
  PhCircleNotch as Loader2,
  PhHardDrives as Server,
  PhWarning as TriangleAlert,
  PhX as X,
} from "@phosphor-icons/vue";
import { SdkError } from "@vynel/sdk";
import type { SshServerResponse } from "@vynel/contracts/ssh/ssh-http";
import { useRemoveSshServer } from "../../composables/ssh-servers/use-remove-ssh-server.js";
import { useTestSshConnection } from "../../composables/ssh-servers/use-test-ssh-connection.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// One server card (ChannelsSection row idiom): the mono target says where,
// Test proves the connection in place, and Remove is a hover-reveal two-step —
// the sealed credential dies with the row, so one click must never delete.
const props = defineProps<{
  server: SshServerResponse;
}>();

const target = computed(
  () => `${props.server.username}@${props.server.host}:${props.server.port}`,
);

const connectionNote = computed(() =>
  props.server.lastConnectedAt === null
    ? "Never connected"
    : `Last connected ${formatRelativeTime(props.server.lastConnectedAt)}`,
);

const testConnection = useTestSshConnection();

function runTest() {
  if (testConnection.isPending.value) return;
  testConnection.mutate({ serverId: props.server.id });
}

// A 409 means the server's key no longer matches the pinned fingerprint —
// possibly a rebuilt machine, possibly someone in the middle. It gets a
// warning tone distinct from a plain "couldn't connect".
const isIdentityChanged = computed(
  () =>
    testConnection.error.value instanceof SdkError &&
    testConnection.error.value.status === 409,
);

const testErrorText = computed(() =>
  testConnection.error.value
    ? formatSdkError(testConnection.error.value)
    : null,
);

const removeServer = useRemoveSshServer();
const isRemoveArmed = ref(false);

function requestRemove() {
  if (!isRemoveArmed.value) {
    isRemoveArmed.value = true;
    return;
  }
  isRemoveArmed.value = false;
  removeServer.mutate({ serverId: props.server.id });
}

function disarmRemove() {
  isRemoveArmed.value = false;
}

const removeErrorText = computed(() =>
  removeServer.error.value ? formatSdkError(removeServer.error.value) : null,
);
</script>

<template>
  <div
    class="row group flex flex-col rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
  >
    <div class="flex items-center gap-3">
      <span
        class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
      >
        <Server :size="17" />
      </span>
      <div class="row-main min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
            {{ props.server.name }}
          </p>
          <span
            v-if="props.server.workspaceId === null"
            class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >Global</span
          >
        </div>
        <p class="row-sub m-0 mt-0.5 truncate font-mono text-xs text-ink-3">
          {{ target }}
        </p>
        <p class="connection-note m-0 mt-0.5 truncate text-xs text-ink-3">
          {{ connectionNote }}
        </p>
      </div>
      <span
        v-if="testConnection.isSuccess.value"
        class="test-ok inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ok"
      >
        <Check :size="12" />
        Connected
      </span>
      <button
        type="button"
        class="test-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-2.5 py-0.5 text-[11px] font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
        :disabled="testConnection.isPending.value"
        :title="`Test connection to ${props.server.name}`"
        :aria-label="`Test connection to ${props.server.name}`"
        @click="runTest"
      >
        <Loader2
          v-if="testConnection.isPending.value"
          :size="11"
          class="animate-spin"
        />
        {{ testConnection.isPending.value ? "Testing…" : "Test" }}
      </button>
      <button
        type="button"
        :class="
          isRemoveArmed
            ? 'remove-confirm inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-2.5 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
            : 'remove-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100'
        "
        :title="
          isRemoveArmed
            ? `Confirm remove ${props.server.name}`
            : `Remove ${props.server.name}`
        "
        :aria-label="
          isRemoveArmed
            ? `Confirm remove ${props.server.name}`
            : `Remove ${props.server.name}`
        "
        @click="requestRemove"
        @blur="disarmRemove"
      >
        <template v-if="isRemoveArmed">Sure?</template>
        <X v-else :size="14" />
      </button>
    </div>

    <p
      v-if="testErrorText"
      class="test-alert m-0 mt-2 flex items-start gap-1.5 text-xs"
      :class="isIdentityChanged ? 'is-warn text-gold' : 'is-danger text-danger'"
      role="alert"
    >
      <TriangleAlert
        v-if="isIdentityChanged"
        :size="13"
        class="mt-px shrink-0"
      />
      {{ testErrorText }}
    </p>
    <p v-if="removeErrorText" class="m-0 mt-2 text-xs text-danger" role="alert">
      {{ removeErrorText }}
    </p>
  </div>
</template>
