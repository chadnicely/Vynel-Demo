import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";

/**
 * Consecutive calls of the same tool render as one group ("Read 2 files").
 * Order is preserved; a different tool starts a new run.
 */
export function groupConsecutiveToolCalls(
  toolCalls: ChatToolCallResponse[],
): ChatToolCallResponse[][] {
  const groups: ChatToolCallResponse[][] = [];
  for (const toolCall of toolCalls) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup[0]!.toolName === toolCall.toolName) {
      currentGroup.push(toolCall);
    } else {
      groups.push([toolCall]);
    }
  }
  return groups;
}
