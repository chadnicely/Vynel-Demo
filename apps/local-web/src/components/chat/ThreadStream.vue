<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import { MessageRow, ToolCallList } from "@vynel/ui";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";
import LiveTurn from "./LiveTurn.vue";

const props = defineProps<{
  messages: ChatMessageResponse[];
  toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
  activeTurn: ActiveTurnView | null;
}>();

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
}>();

const scroller = ref<HTMLElement | null>(null);

// Follow the live edge: any growth in history or the streaming turn keeps the
// newest content in view.
watch(
  () => [
    props.messages.length,
    props.activeTurn?.text.length ?? 0,
    props.activeTurn?.toolCalls.length ?? 0,
    props.activeTurn?.userMessage?.id ?? "",
  ],
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
  },
);
</script>

<template>
  <div ref="scroller" class="thread-stream">
    <div class="thread-column">
      <template v-for="message in props.messages" :key="message.id">
        <MessageRow :message="message">
          <template
            v-if="props.toolCallsByMessageId[message.id]?.length"
            #tool-calls
          >
            <ToolCallList
              class="tool-list"
              :tool-calls="props.toolCallsByMessageId[message.id] ?? []"
            />
          </template>
        </MessageRow>
      </template>

      <template v-if="props.activeTurn">
        <MessageRow
          v-if="props.activeTurn.userMessage"
          :message="props.activeTurn.userMessage"
        />
        <LiveTurn
          :view="props.activeTurn"
          @decide-approval="
            (id, decision) => emit('decideApproval', id, decision)
          "
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.thread-stream {
  height: 100%;
  overflow-y: auto;
}

.thread-column {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 24px 16px;
  display: grid;
  gap: 20px;
}

.tool-list {
  margin-top: 4px;
}
</style>
