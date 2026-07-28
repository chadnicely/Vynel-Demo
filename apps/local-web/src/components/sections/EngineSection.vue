<script setup lang="ts">
import { computed, ref } from "vue";
import { Cpu, Plus } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useServerInstalls } from "../../composables/server-install/use-server-installs.js";
import { useEngineLocation } from "../../composables/shell/use-engine-location.js";
import EngineInstallRow from "../engine/EngineInstallRow.vue";
import ProvisionServerDialog from "../engine/ProvisionServerDialog.vue";
import SectionHeader from "./SectionHeader.vue";

// Where Vynel's engine runs — this computer, or the user's own server. The
// choice lives in the SHELL (read before any engine starts), so switching is
// save-then-restart; outside the desktop app the switch is unavailable and
// this says so instead of pretending.

const installsQuery = useServerInstalls(true);
const engine = useEngineLocation();
const isProvisionOpen = ref(false);
const pendingRestartFor = ref<string | null>(null);

const installs = computed(() => installsQuery.data.value ?? []);
const runsHere = computed(() => engine.mode.value === "local");

async function useInstall(installId: string) {
  const saved = await engine.save({ mode: "remote", installId });
  if (saved) pendingRestartFor.value = installId;
}

async function useThisComputer() {
  const saved = await engine.save({ mode: "local" });
  if (saved) pendingRestartFor.value = "local";
}
</script>

<template>
  <div class="engine-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Cpu"
      title="Where Vynel runs"
      subtitle="Vynel's engine can run on this computer, or on a server you own so it keeps working while your computer sleeps."
    >
      <template #actions>
        <button
          v-if="installs.length"
          class="add-button cursor-default rounded-full border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1"
          @click="isProvisionOpen = true"
        >
          <Plus :size="12" /> Add a server
        </button>
      </template>
    </SectionHeader>

    <div
      class="current-engine flex items-center justify-between gap-3 rounded-lg border border-hair bg-raised p-3"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-[13px] font-semibold text-ink-1">
          {{ runsHere ? "This computer" : "Your server" }}
        </span>
        <span class="text-xs text-ink-2">
          {{
            runsHere
              ? "Vynel runs here. It stops when this computer sleeps or shuts down."
              : "Vynel runs on your server and keeps working when this computer is off."
          }}
        </span>
      </div>
      <button
        v-if="!runsHere && engine.isAvailable"
        class="use-local-button cursor-default rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1"
        @click="useThisComputer"
      >
        Run on this computer
      </button>
    </div>

    <p
      v-if="pendingRestartFor !== null"
      class="restart-notice m-0 flex items-center justify-between gap-3 rounded-lg border border-gold bg-raised p-3 text-xs text-ink-1"
      role="status"
    >
      <span>Saved. Vynel needs to restart to switch over.</span>
      <button
        class="restart-button cursor-default rounded-sm bg-gold px-3 py-1 text-[11px] font-semibold text-shell transition hover:bg-gold-bright"
        @click="engine.restartApp()"
      >
        Restart now
      </button>
    </p>

    <p v-if="engine.errorMessage.value" class="m-0 text-xs text-danger" role="alert">
      {{ engine.errorMessage.value }}
    </p>
    <p v-else-if="!engine.isAvailable" class="unavailable-note m-0 text-xs text-ink-3">
      Switching where Vynel runs is only available in the desktop app.
    </p>

    <div v-if="installs.length" class="rows flex flex-col gap-2">
      <EngineInstallRow
        v-for="install in installs"
        :key="install.id"
        :install="install"
        :is-active="!runsHere && engine.installId.value === install.id"
        @use="useInstall"
      />
    </div>
    <EmptyState
      v-else
      title="No servers yet"
      hint="Add a Linux server and Vynel installs itself there — then it keeps working even when this computer is off."
    >
      <template #icon><Cpu :size="20" /></template>
      <template #action>
        <button
          class="add-button cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright"
          @click="isProvisionOpen = true"
        >
          Add a server
        </button>
      </template>
    </EmptyState>

    <ProvisionServerDialog
      :open="isProvisionOpen"
      @close="isProvisionOpen = false"
      @started="isProvisionOpen = false"
    />
  </div>
</template>
