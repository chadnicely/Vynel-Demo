<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, Server } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useSshServers } from "../../composables/ssh-servers/use-ssh-servers.js";
import AddServerDialog from "../ssh/AddServerDialog.vue";
import SshServerRow from "../ssh/SshServerRow.vue";
import SectionHeader from "./SectionHeader.vue";
import type { SectionScope } from "./section-scope.js";

// The servers section, on either surface: the machines Claude can reach over
// SSH. A workspace drawer shows its own servers plus the global ones; the
// global menu shows ONLY global servers (the channels filter convention —
// where you are IS the scope).
const props = defineProps<{
  scope: SectionScope;
}>();

const serversQuery = useSshServers(true);

const servers = computed(() => {
  const rows = serversQuery.data.value ?? [];
  if (props.scope.kind === "global")
    return rows.filter((row) => row.workspaceId === null);
  const workspaceId = props.scope.workspaceId;
  return rows.filter(
    (row) => row.workspaceId === null || row.workspaceId === workspaceId,
  );
});

const isAddOpen = ref(false);

function onAdded() {
  isAddOpen.value = false;
}
</script>

<template>
  <div class="ssh-servers-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Server"
      title="Servers"
      subtitle="The machines Claude can connect to and look after for you"
    >
      <template v-if="servers.length > 0" #actions>
        <button
          type="button"
          class="add-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add server
        </button>
      </template>
    </SectionHeader>

    <div v-if="servers.length > 0" class="rows flex flex-col gap-2">
      <SshServerRow
        v-for="server in servers"
        :key="server.id"
        :server="server"
      />
    </div>

    <EmptyState
      v-else
      title="No servers yet"
      hint="Add the machine your website runs on — Claude connects for you and does the work, without ever seeing the password."
    >
      <template #icon>
        <Server :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add a server
        </button>
      </template>
    </EmptyState>

    <AddServerDialog
      :open="isAddOpen"
      :default-scope="props.scope"
      @close="isAddOpen = false"
      @added="onAdded"
    />
  </div>
</template>
