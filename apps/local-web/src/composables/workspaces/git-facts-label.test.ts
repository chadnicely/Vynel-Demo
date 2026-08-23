import { describe, expect, it } from "vitest";
import { describeGitFacts } from "./git-facts-label.js";
import type { WorkspaceGit } from "./use-workspace-git.js";

function repository(
  overrides: Partial<Extract<WorkspaceGit["facts"], { kind: "repository" }>>,
  worktrees = 1,
): WorkspaceGit {
  return {
    facts: {
      kind: "repository",
      branch: "main",
      upstream: null,
      ahead: null,
      behind: null,
      changedCount: 0,
      untrackedCount: 0,
      remoteUrl: null,
      ...overrides,
    },
    branches: [],
    worktrees: Array.from({ length: worktrees }, (_, index) => ({
      path: `/repo/${index}`,
      branch: "main",
      isMain: index === 0,
    })),
  };
}

describe("describeGitFacts", () => {
  it("reads a clean local branch as just its name", () => {
    expect(describeGitFacts(repository({}))).toEqual({
      label: "main",
      detail: "No remote · No upstream · No worktrees",
      tone: "neutral",
    });
  });

  it("adds the uncommitted count and the upstream distance", () => {
    const label = describeGitFacts(
      repository(
        {
          upstream: "origin/main",
          ahead: 2,
          behind: 1,
          changedCount: 2,
          untrackedCount: 1,
          remoteUrl: "https://github.com/acme/app.git",
        },
        3,
      ),
    );
    expect(label.label).toBe("main · 3 uncommitted · ↑2 ↓1");
    expect(label.detail).toBe(
      "Remote: https://github.com/acme/app.git · Tracks origin/main · 2 worktrees",
    );
  });

  it("says detached when there is no branch and skips a zero distance", () => {
    const label = describeGitFacts(
      repository({
        branch: null,
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
      }),
    );
    expect(label.label).toBe("detached");
  });

  it("words every non-repository answer, problems marked as such", () => {
    const base = { branches: [], worktrees: [] };
    expect(
      describeGitFacts({ ...base, facts: { kind: "not-a-repository" } }),
    ).toMatchObject({
      label: "No git yet",
      tone: "muted",
    });
    expect(
      describeGitFacts({ ...base, facts: { kind: "no-git" } }),
    ).toMatchObject({
      label: "git not installed",
      tone: "problem",
    });
    expect(
      describeGitFacts({ ...base, facts: { kind: "folder-missing" } }),
    ).toMatchObject({
      label: "Folder missing",
      tone: "problem",
    });
    expect(
      describeGitFacts({
        ...base,
        facts: { kind: "unreadable", reason: "dubious ownership" },
      }),
    ).toEqual({
      label: "git unreadable",
      detail: "dubious ownership",
      tone: "problem",
    });
  });
});
