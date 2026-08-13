<script setup lang="ts">
import { computed } from "vue";
import { useSetCapabilityEnabled } from "../../../composables/capabilities/use-set-capability-enabled.js";
import { useWorkspaceCapabilities } from "../../../composables/capabilities/use-workspace-capabilities.js";
import type { WorkspaceCapabilityStatus } from "../../../composables/capabilities/use-workspace-capabilities.js";
import { formatSdkError } from "../../../utils/format-sdk-error.js";

// The workspace's capability switches — the first UI over
// /workspaces/:id/capabilities. Enablement is per workspace by design, which
// is why this panel only mounts on the workspace surface while the tool
// matrix below it stays machine-wide.
const props = defineProps<{
  workspaceId: string;
}>();

const capabilitiesQuery = useWorkspaceCapabilities(() => props.workspaceId);
const capabilities = computed(() => capabilitiesQuery.data.value ?? []);

const setEnabled = useSetCapabilityEnabled();

function toggle(capability: WorkspaceCapabilityStatus) {
  setEnabled.mutate({
    workspaceId: props.workspaceId,
    capabilityId: capability.id,
    isEnabled: !capability.isEnabled,
  });
}

function isToggling(capability: WorkspaceCapabilityStatus): boolean {
  return (
    setEnabled.isPending.value &&
    setEnabled.variables.value?.capabilityId === capability.id
  );
}

const errorMessage = computed(() =>
  setEnabled.error.value ? formatSdkError(setEnabled.error.value) : null,
);
</script>

<template>
  <section class="capability-panel flex flex-col gap-2">
    <div>
      <p class="m-0 text-[12.5px] font-semibold text-ink-1">Capabilities</p>
      <p class="m-0 text-[11px] text-ink-3">
        What the assistant can use in this workspace — switches apply here
        only.
      </p>
    </div>

    <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="capabilities.length > 0" class="rows flex flex-col gap-1.5">
      <div
        v-for="capability in capabilities"
        :key="capability.id"
        class="capability-row flex items-center gap-3 rounded-lg border border-hair bg-raised px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[12.5px] font-semibold text-ink-1">
            {{ capability.displayName }}
          </p>
          <p
            class="m-0 mt-px truncate text-[11px] text-ink-3"
            :title="capability.description"
          >
            {{ capability.description }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="capability.isEnabled"
          :aria-label="`Turn ${capability.displayName} ${capability.isEnabled ? 'off' : 'on'} for this workspace`"
          :disabled="isToggling(capability)"
          class="capability-switch flex shrink-0 cursor-default items-center gap-1.5 text-[11px] font-medium text-ink-2 transition enabled:hover:text-ink-1 disabled:opacity-55"
          @click="toggle(capability)"
        >
          {{ capability.isEnabled ? "On" : "Off" }}
          <span
            class="relative h-3.5 w-6 rounded-full border transition"
            :class="
              capability.isEnabled
                ? 'border-gold bg-gold-soft'
                : 'border-hair-strong bg-panel'
            "
          >
            <span
              class="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-all"
              :class="
                capability.isEnabled
                  ? 'left-[11px] bg-gold'
                  : 'left-[2px] bg-ink-3'
              "
            />
          </span>
        </button>
      </div>
    </div>
  </section>
</template>
