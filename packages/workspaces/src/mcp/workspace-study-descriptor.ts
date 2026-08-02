// The `vynel-workspace-study` MCP feature descriptor (chat-mentions, `#`) —
// per-TURN read-only study access to exactly the workspaces the user's message
// referenced with `#`. A FACTORY (the ssh/asks precedent): the legal set is
// resolved by the SERVER from the message text (never from client hints) and
// threaded in here; the composed tools are gated to those ids and exist only
// for turns whose message carried the refs — per-message, not sticky (Chad,
// 2026-08-02).
//
// READ-ONLY BY CONSTRUCTION: three tools, no mutations, `mutatingToolNames`
// empty (nothing cards). Path containment + symlink defense + size caps live
// in `workspace-study-tools.ts` (directly tested).

import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpFeatureDescriptor } from '@vynel/mcp-contract'
import type { McpToolFn } from './mcp-tool-fn.js'
import {
  getWorkspaceOverviewForStudy,
  listWorkspaceFilesForStudy,
  readWorkspaceFileForStudy,
  resolveStudyWorkspace,
  type StudyWorkspace,
} from './workspace-study-tools.js'

const OVERVIEW_DESCRIPTION =
  'Orient yourself in a #-referenced workspace: its name, manager, folder path, and ' +
  'top-level contents. Read-only. Start here before listing or reading files.'

const LIST_DESCRIPTION =
  'List files in a #-referenced workspace (bounded recursive tree, dependency/build ' +
  'folders skipped, directories end with "/"). Optional `path` narrows to a ' +
  'subdirectory. Read-only.'

const READ_DESCRIPTION =
  'Read one text file from a #-referenced workspace by workspace-relative path. ' +
  'Size-capped; binary files are refused. Read-only.'

function asTextResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function asToolError(err: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: boolean
} {
  return {
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  }
}

/** Build the per-turn study descriptor over the resolved #-mentioned set.
 *  An empty set composes NOTHING (isApplicable false — the common turn). */
export function buildWorkspaceStudyDescriptor(deps: {
  workspaces: readonly StudyWorkspace[]
}): McpFeatureDescriptor {
  const { workspaces } = deps
  return {
    serverName: 'vynel-workspace-study',
    isApplicable: () => workspaces.length > 0,
    build: () => {
      if (workspaces.length === 0) return null
      const overviewTool = (tool as unknown as McpToolFn)(
        'get_workspace_overview',
        OVERVIEW_DESCRIPTION,
        { workspaceId: z.string().min(1) },
        async (args) => {
          try {
            const workspace = resolveStudyWorkspace(workspaces, args.workspaceId as string)
            return asTextResult(getWorkspaceOverviewForStudy(workspace))
          } catch (err) {
            return asToolError(err)
          }
        },
        { annotations: { readOnlyHint: true } },
      )
      const listTool = (tool as unknown as McpToolFn)(
        'list_workspace_files',
        LIST_DESCRIPTION,
        { workspaceId: z.string().min(1), path: z.string().min(1).optional() },
        async (args) => {
          try {
            const workspace = resolveStudyWorkspace(workspaces, args.workspaceId as string)
            return asTextResult(
              listWorkspaceFilesForStudy(workspace, (args.path as string | undefined) ?? '.'),
            )
          } catch (err) {
            return asToolError(err)
          }
        },
        { annotations: { readOnlyHint: true } },
      )
      const readTool = (tool as unknown as McpToolFn)(
        'read_workspace_file',
        READ_DESCRIPTION,
        { workspaceId: z.string().min(1), path: z.string().min(1) },
        async (args) => {
          try {
            const workspace = resolveStudyWorkspace(workspaces, args.workspaceId as string)
            return asTextResult(readWorkspaceFileForStudy(workspace, args.path as string))
          } catch (err) {
            return asToolError(err)
          }
        },
        { annotations: { readOnlyHint: true } },
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK widening at the factory boundary (the ssh precedent).
      const tools = [overviewTool, listTool, readTool].map((t) => t as SdkMcpToolDefinition<any>)
      return createSdkMcpServer({ name: 'vynel-workspace-study', version: '1.0.0', tools })
    },
    mutatingToolNames: [], // Read-only by construction — nothing cards.
    contributePrompt: () => {
      if (workspaces.length === 0) return null
      const granted = workspaces
        .map((workspace) => `"${workspace.name}" (workspaceId: ${workspace.id})`)
        .join(', ')
      return (
        `Workspace study access (THIS message only): the user referenced ${granted} with #. ` +
        'You have read-only study tools scoped to exactly these workspaces — ' +
        'get_workspace_overview, list_workspace_files, read_workspace_file. Use them to ' +
        'study the referenced workspaces and answer. On later messages these tools are gone ' +
        'unless the user references a workspace with # again — that disappearance is normal, ' +
        'never an error to report.'
      )
    },
  }
}

export type { StudyWorkspace }
