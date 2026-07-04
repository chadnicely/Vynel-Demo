import type {
  ChatMessageResponse,
  ChatSessionResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";

/** The pseudo-workspace the global root chat's demo sessions hang off. */
export const DEMO_GLOBAL_ROOT_WORKSPACE_ID = "demo-ws-global-root";

/** The global "one brain" thread — hidden from the history list (the real
 *  continuing-root model keeps its segments unlisted too). */
export const DEMO_GLOBAL_CONTINUOUS_SESSION_ID = "demo-continuous-global";

function makeSession(
  overrides: Partial<ChatSessionResponse> &
    Pick<ChatSessionResponse, "id" | "workspaceId" | "title">,
): ChatSessionResponse {
  return {
    userId: "demo-user",
    providerId: "claude",
    model: "claude-opus-4-8",
    isArchived: false,
    visibility: "listed",
    deletedAt: null,
    totalMessageCount: 2,
    totalInputTokens: 8200,
    totalOutputTokens: 1400,
    lastMessagePreview: null,
    startedAt: "2026-07-03T09:00:00.000Z",
    lastMessageAt: "2026-07-03T09:04:00.000Z",
    updatedAt: "2026-07-03T09:04:00.000Z",
    ...overrides,
  };
}

export const demoSessions: ChatSessionResponse[] = [
  makeSession({
    id: DEMO_GLOBAL_CONTINUOUS_SESSION_ID,
    workspaceId: DEMO_GLOBAL_ROOT_WORKSPACE_ID,
    title: "Ongoing conversation",
    visibility: "hidden",
    lastMessagePreview:
      "Done — your journal template is saved and tomorrow's page is ready.",
    startedAt: "2026-07-04T07:58:00.000Z",
    lastMessageAt: "2026-07-04T08:03:00.000Z",
    updatedAt: "2026-07-04T08:03:00.000Z",
  }),
  makeSession({
    id: "demo-session-quick-report",
    workspaceId: DEMO_GLOBAL_ROOT_WORKSPACE_ID,
    title: "Quick report on Project A",
    lastMessagePreview:
      "The summary is in your Reports folder — three risks flagged.",
    startedAt: "2026-07-02T14:20:00.000Z",
    lastMessageAt: "2026-07-02T14:31:00.000Z",
    updatedAt: "2026-07-02T14:31:00.000Z",
  }),
  makeSession({
    id: "demo-session-pricing",
    workspaceId: "demo-ws-marketing",
    title: "Refresh pricing page copy",
    lastMessagePreview: "Pricing section rewritten; the build passed.",
    startedAt: "2026-07-01T11:00:00.000Z",
    lastMessageAt: "2026-07-01T11:12:00.000Z",
    updatedAt: "2026-07-01T11:12:00.000Z",
  }),
  makeSession({
    id: "demo-session-invoices",
    workspaceId: "demo-ws-bookkeeping",
    title: "June invoice reconciliation",
    lastMessagePreview: "All 14 invoices matched; two duplicates archived.",
    startedAt: "2026-06-30T16:00:00.000Z",
    lastMessageAt: "2026-06-30T16:22:00.000Z",
    updatedAt: "2026-06-30T16:22:00.000Z",
  }),
];

// One finished conversation with a full activity trail, so history rendering
// (messages + tool cards) is demonstrable before the chat read API exists.
export const demoMessagesBySessionId: Record<string, ChatMessageResponse[]> = {
  [DEMO_GLOBAL_CONTINUOUS_SESSION_ID]: [
    {
      id: "demo-msg-journal-user",
      sessionId: DEMO_GLOBAL_CONTINUOUS_SESSION_ID,
      role: "user",
      body: "On vynel I want to create a journal file I fill in every morning. Set it up for me?",
      thinkingBody: null,
      inputTokens: null,
      outputTokens: null,
      attachedImagesMetadata: null,
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-07-04T07:58:10.000Z",
      completedAt: "2026-07-04T07:58:10.000Z",
      createdAt: "2026-07-04T07:58:10.000Z",
    },
    {
      id: "demo-msg-journal-assistant",
      sessionId: DEMO_GLOBAL_CONTINUOUS_SESSION_ID,
      role: "assistant",
      body: "All set. I created **journal/2026-07-04.md** from a template with three prompts — *focus*, *gratitude*, and *notes* — and a small script that copies it forward each morning.\n\nTomorrow's page will be waiting for you. Want me to add a reminder through Telegram as well?",
      thinkingBody:
        "The user wants a recurring journal file. Simplest shape: a markdown template plus a scheduled copy. I should create the folder, the template, and today's page.",
      inputTokens: 5200,
      outputTokens: 610,
      attachedImagesMetadata: null,
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-07-04T07:58:12.000Z",
      completedAt: "2026-07-04T08:03:00.000Z",
      createdAt: "2026-07-04T07:58:12.000Z",
    },
  ],
};

export const demoToolCallsByMessageId: Record<string, ChatToolCallResponse[]> =
  {
    "demo-msg-journal-assistant": [
      {
        id: "demo-tool-journal-1",
        parentMessageId: "demo-msg-journal-assistant",
        toolUseId: "demo-tooluse-journal-1",
        toolName: "Write",
        toolInput: {
          file_path: "journal/_template.md",
          content: "# {{date}}\n\n## Focus\n\n## Gratitude\n\n## Notes\n",
        },
        toolOutput: "File created (4 lines)",
        status: "completed",
        approvalStatus: "approved",
        isErrorResult: false,
        startedAt: "2026-07-04T07:58:40.000Z",
        completedAt: "2026-07-04T07:58:41.200Z",
      },
      {
        id: "demo-tool-journal-2",
        parentMessageId: "demo-msg-journal-assistant",
        toolUseId: "demo-tooluse-journal-2",
        toolName: "Write",
        toolInput: {
          file_path: "journal/2026-07-04.md",
          content: "# 2026-07-04 …",
        },
        toolOutput: "File created (4 lines)",
        status: "completed",
        approvalStatus: "approved",
        isErrorResult: false,
        startedAt: "2026-07-04T07:59:02.000Z",
        completedAt: "2026-07-04T07:59:03.100Z",
      },
      {
        id: "demo-tool-journal-3",
        parentMessageId: "demo-msg-journal-assistant",
        toolUseId: "demo-tooluse-journal-3",
        toolName: "Bash",
        toolInput: { command: "ls journal/" },
        toolOutput: "_template.md\n2026-07-04.md",
        status: "completed",
        approvalStatus: null,
        isErrorResult: false,
        startedAt: "2026-07-04T07:59:20.000Z",
        completedAt: "2026-07-04T07:59:20.600Z",
      },
    ],
  };
