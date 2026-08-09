// The delivered-row stats enrichment: an inbound colleague row gains the
// PRODUCING run's stats (model, tool calls, tokens, duration) resolved from
// the chain's work hop + its message trace. Real SQLite, real jobs.

import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "@vynel/testing";
import type { Database } from "@vynel/db";
import { insertUser } from "@vynel/db/repositories/users";
import { insertWorkspace } from "@vynel/db/repositories/workspaces";
import {
  insertChatSession,
  insertChatMessage,
  insertChatToolCall,
} from "@vynel/chat/repositories";
import {
  enqueueWorkspaceDelegation,
  enqueueReportDelivery,
  claimNextPendingDelegationJob,
  completeDelegationJob,
  markDelegationJobReported,
  findDelegationJobById,
} from "@vynel/orchestration";
import { attachDeliveredRunStats } from "./attach-delivered-run-stats.js";

function seedUser(db: Database) {
  const now = new Date();
  return insertUser(db, {
    id: randomUUID(),
    displayName: "T",
    emailAddress: null,
    locale: "en-US",
    timezone: "UTC",
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  });
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date();
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: "Acme",
    kind: "personal" as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  });
}

function seedSession(
  db: Database,
  userId: string,
  workspaceId: string,
  model: string | null,
) {
  const now = new Date();
  const id = `session-${randomUUID()}`;
  insertChatSession(db, {
    id,
    userId,
    workspaceId,
    providerId: "claude",
    model,
    title: "ws root",
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  });
  return id;
}

function seedTracedAssistantRow(
  db: Database,
  sessionId: string,
  partialSessionId: string,
  tokens: { input: number; output: number },
  // Distinct per row — the last-row expectation reads the asc(startedAt)
  // order, and a same-millisecond tie would leave it to the rowid.
  startedAt: Date = new Date(),
) {
  const id = `msg-${randomUUID()}`;
  insertChatMessage(db, {
    id,
    sessionId,
    role: "assistant",
    body: "working…",
    partialSessionId,
    thinkingBody: null,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt,
    completedAt: startedAt,
    createdAt: startedAt,
  });
  return id;
}

describe("attachDeliveredRunStats", () => {
  it("a delivered row gains the producing run stats: model, tool calls, token sums, claim→report duration", async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db);
      const workspace = seedWorkspace(db, user.id);
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: "g-1",
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: "give the user an overview",
        model: "claude-opus-x",
      });
      const claimedAt = new Date("2026-08-09T10:00:00Z");
      expect(claimNextPendingDelegationJob(db, claimedAt)?.id).toBe(jobId);
      const work = findDelegationJobById(db, jobId)!;

      // The colleague's run: two traced assistant rows, one tool call.
      const sessionId = seedSession(db, user.id, workspace.id, null);
      const rowId = seedTracedAssistantRow(
        db,
        sessionId,
        work.partialSessionId!,
        { input: 100, output: 50 },
        new Date("2026-08-09T10:00:01Z"),
      );
      seedTracedAssistantRow(
        db,
        sessionId,
        work.partialSessionId!,
        { input: 200, output: 25 },
        new Date("2026-08-09T10:00:02Z"),
      );
      insertChatToolCall(db, {
        id: randomUUID(),
        parentMessageId: rowId,
        toolUseId: `toolu_${randomUUID()}`,
        toolName: "Read",
        toolInput: {},
        toolOutput: null,
        status: "completed",
        approvalStatus: null,
        isErrorResult: false,
        startedAt: claimedAt,
        completedAt: claimedAt,
      });

      markDelegationJobReported(db, jobId, new Date("2026-08-09T10:00:05Z"));
      completeDelegationJob(
        db,
        jobId,
        "done",
        new Date("2026-08-09T10:00:06Z"),
      );
      const deliveryId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: sessionId,
        reporterLabel: "Mark · Acme",
        reportBody: "Overview.",
        requester: { kind: "global-root" },
        threadId: work.threadId!,
      });
      const deliveryKey = findDelegationJobById(
        db,
        deliveryId,
      )!.partialSessionId!;

      const [plain, delivered] = attachDeliveredRunStats(db, [
        { id: "p1", role: "user", sourceKind: null, partialSessionId: null },
        {
          id: "d1",
          role: "user",
          sourceKind: "workspace-manager",
          partialSessionId: deliveryKey,
        },
      ]);
      expect(plain).not.toHaveProperty("runStats");
      expect((delivered as { runStats?: unknown }).runStats).toEqual({
        // The job's override wins over the session model.
        model: "claude-opus-x",
        toolCallCount: 1,
        // test: correct expectation — a row's inputTokens is the request's
        // WHOLE context occupancy, so the run's "in" is the LAST row's value
        // (was 300, the sum — the 462.8k over-count Chad caught). Output is
        // per-generation fresh tokens: the sum stays.
        inputTokens: 200,
        outputTokens: 75,
        durationMs: 5000,
      });
    });
  });

  it("falls back to the SESSION model without an override, and passes through when the job is gone", async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db);
      const workspace = seedWorkspace(db, user.id);
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: "g-1",
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: "t",
      });
      claimNextPendingDelegationJob(db, new Date());
      const work = findDelegationJobById(db, jobId)!;
      const sessionId = seedSession(
        db,
        user.id,
        workspace.id,
        "claude-sonnet-y",
      );
      seedTracedAssistantRow(db, sessionId, work.partialSessionId!, {
        input: 10,
        output: 5,
      });
      markDelegationJobReported(db, jobId, new Date());
      const deliveryId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: sessionId,
        reporterLabel: "Mark · Acme",
        reportBody: "r",
        requester: { kind: "global-root" },
        threadId: work.threadId!,
      });
      const deliveryKey = findDelegationJobById(
        db,
        deliveryId,
      )!.partialSessionId!;

      const [withStats, orphan] = attachDeliveredRunStats(db, [
        {
          id: "d1",
          role: "user",
          sourceKind: "agent",
          partialSessionId: deliveryKey,
        },
        {
          id: "d2",
          role: "user",
          sourceKind: "agent",
          partialSessionId: randomUUID(),
        },
      ]);
      expect(
        (withStats as { runStats?: { model: string | null } }).runStats?.model,
      ).toBe("claude-sonnet-y");
      expect(orphan).not.toHaveProperty("runStats");
    });
  });
});
