// The mention-picker rosters (chat-mentions) — pure mapping from the app's
// real rows to `ComposerSuggestItem`s. Extracted from AppComposer so the
// rules are testable without mounting the query stack: self-exclusion, the
// archived filter, install health, and the grammar-format round-trip (insert
// tokens come from the contracts helpers, so what the picker writes is
// exactly what the server re-parses).

import type { ComposerSuggestItem } from "@vynel/ui";
import {
  formatAgentMentionToken,
  formatPersonaMentionToken,
  formatSlashCommandToken,
  formatWorkspaceRefToken,
  parseComposerTokens,
} from "@vynel/contracts/chat/composer-tokens";
import {
  formatManagerLabel,
  resolveManagerName,
} from "@vynel/contracts/workspaces/manager-name";

// A picker must never offer a token that cannot work: `managerName` is
// renameable to ANY 1–60-char string ("Mary Jane") and workspace names may
// carry double quotes — the formatted token then parses back to a DIFFERENT
// name, fails the server's exact-name resolution, and silently no-ops. Drop
// such rows instead of offering a dead token.
function mentionTokenRoundTrips(insert: string, name: string): boolean {
  const parsed = parseComposerTokens(insert).mentions;
  return parsed.length === 1 && parsed[0]!.name === name;
}

function workspaceTokenRoundTrips(insert: string, name: string): boolean {
  const parsed = parseComposerTokens(insert).workspaceRefs;
  return parsed.length === 1 && parsed[0]!.name === name;
}

// Structural row shapes — the SDK responses satisfy them; the mapping never
// needs more than these fields.
export interface AgentRosterRow {
  id: string;
  slug: string;
  name: string;
}
export interface WorkspaceRosterRow {
  id: string;
  name: string;
  managerName: string | null;
  isArchived: boolean;
}
export interface CommandRosterRow {
  commandName: string;
  description: string | null;
  scope: string;
}
export interface SkillRosterRow {
  id: string;
  skillId: string;
  installHealth: string;
  definition: { displayName: string } | null;
}

/** Non-archived workspaces, the current one excluded — its persona is who
 *  you're already talking to; a self-# grants nothing the chat lacks. */
export function selectOtherWorkspaces(
  workspaces: readonly WorkspaceRosterRow[],
  currentWorkspaceId: string | null,
): WorkspaceRosterRow[] {
  return workspaces.filter(
    (workspace) => !workspace.isArchived && workspace.id !== currentWorkspaceId,
  );
}

export function buildMentionSuggestions(
  agents: readonly AgentRosterRow[],
  otherWorkspaces: readonly WorkspaceRosterRow[],
): ComposerSuggestItem[] {
  return [
    ...agents
      .filter((agent) => mentionTokenRoundTrips(formatAgentMentionToken(agent.slug), agent.slug))
      .map((agent) => ({
        id: `agent:${agent.id}`,
        label: agent.name,
        hint: `@${agent.slug} · agent`,
        group: "Agents",
        insert: formatAgentMentionToken(agent.slug),
      })),
    ...otherWorkspaces.flatMap((workspace) => {
      const managerName = resolveManagerName(workspace);
      const insert = formatPersonaMentionToken(managerName);
      if (!mentionTokenRoundTrips(insert, managerName)) return [];
      return [
        {
          id: `persona:${workspace.id}`,
          label: formatManagerLabel(managerName, workspace.name),
          hint: "workspace manager",
          group: "People",
          insert,
        },
      ];
    }),
  ];
}

export function buildWorkspaceSuggestions(
  otherWorkspaces: readonly WorkspaceRosterRow[],
): ComposerSuggestItem[] {
  return otherWorkspaces.flatMap((workspace) => {
    const insert = formatWorkspaceRefToken(workspace.name);
    if (!workspaceTokenRoundTrips(insert, workspace.name)) return [];
    return [
      {
        id: `workspace:${workspace.id}`,
        label: workspace.name,
        hint: resolveManagerName(workspace),
        group: "Workspaces",
        insert,
      },
    ];
  });
}

export function buildSlashSuggestions(
  commands: readonly CommandRosterRow[],
  skills: readonly SkillRosterRow[],
): ComposerSuggestItem[] {
  return [
    ...commands.map((command) => ({
      id: `command:${command.scope}:${command.commandName}`,
      label: formatSlashCommandToken(command.commandName),
      ...(command.description !== null ? { hint: command.description } : {}),
      group: "Commands",
      insert: formatSlashCommandToken(command.commandName),
    })),
    // Skills are not slash-native in the runtime — picking one inserts an
    // explicit instruction instead (honest; commands stay slash-verbatim).
    ...skills
      .filter((skill) => skill.installHealth === "healthy")
      .map((skill) => ({
        id: `skill:${skill.id}`,
        label: skill.definition?.displayName ?? skill.skillId,
        hint: "skill",
        group: "Skills",
        insert: `Use the ${skill.skillId} skill: `,
      })),
  ];
}
