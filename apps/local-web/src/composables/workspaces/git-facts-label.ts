import type { WorkspaceGit } from "./use-workspace-git.js";

// The header's one-line reading of a workspace's git — "main · 3 uncommitted
// · ↑1 ↓2" — with the longer story (remote, upstream, worktrees) as the
// tooltip. Every non-repository case gets honest words, none gets hidden.

export type GitFactsLabel = {
  label: string;
  /** The tooltip — the remote address, the upstream, how many worktrees. */
  detail: string;
  tone: "neutral" | "muted" | "problem";
};

export function describeGitFacts(git: WorkspaceGit): GitFactsLabel {
  const { facts } = git;
  switch (facts.kind) {
    case "not-a-repository":
      return {
        label: "No git yet",
        detail: "This folder is not a git repository.",
        tone: "muted",
      };
    case "no-git":
      return {
        label: "git not installed",
        detail: "git isn't installed on this computer (or isn't on PATH).",
        tone: "problem",
      };
    case "folder-missing":
      return {
        label: "Folder missing",
        detail: "The workspace folder is gone from disk.",
        tone: "problem",
      };
    case "unreadable":
      return {
        label: "git unreadable",
        detail: facts.reason,
        tone: "problem",
      };
    case "repository": {
      const parts = [facts.branch ?? "detached"];
      const uncommitted = facts.changedCount + facts.untrackedCount;
      if (uncommitted > 0) parts.push(`${uncommitted} uncommitted`);
      const distance = describeDistance(facts.ahead, facts.behind);
      if (distance !== null) parts.push(distance);
      const detail = [
        facts.remoteUrl === null ? "No remote" : `Remote: ${facts.remoteUrl}`,
        facts.upstream === null ? "No upstream" : `Tracks ${facts.upstream}`,
        describeWorktrees(git.worktrees.length),
      ].join(" · ");
      return { label: parts.join(" · "), detail, tone: "neutral" };
    }
  }
}

function describeDistance(
  ahead: number | null,
  behind: number | null,
): string | null {
  if (ahead === null || behind === null) return null;
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.length === 0 ? null : parts.join(" ");
}

function describeWorktrees(count: number): string {
  const extra = count - 1;
  if (extra <= 0) return "No worktrees";
  return extra === 1 ? "1 worktree" : `${extra} worktrees`;
}
