// The top-level `rules` HTTP surface — mounted at `/rules` from
// `apps/local-api/src/app.ts`; the workspace-OWNED read is its twin at
// `/workspaces/:workspaceId/rules`.
//
//   GET    /            -> the user's own ~/.claude/rules folder (the GLOBAL view)
//   GET    /resolved    -> user folder ∪ one workspace's — what a session there follows
//   PUT    /:ruleId     -> create or replace one of the user's own rule files
//   DELETE /:ruleId     -> delete one rule file
//
// Rules are config-is-truth: the `<ruleId>.md` file IS the record, so there
// is no row to serialize — every response re-reads the file it just wrote.
// The write/delete doors take `{ scope, workspaceId? }` the way `/agents`
// does (top-level mount, ambient workspace stamp on workspace turns) so ONE
// tool name serves the global root and a workspace conversation alike.
//
// MCP: the three scope-taking routes are exposed (`list_rules`, `write_rule`,
// `delete_rule`) on the root + workspace-interactive surfaces only — a
// schedule fire or a spawned leaf never rewrites standing instructions.
// `write_rule` cards in ask mode (a rule changes every future session);
// `delete_rule` cards as every DELETE does.

import { resolver, validator } from 'hono-openapi/zod'
import {
  deleteOwnRuleFileForScope,
  listAllRuleFilesForScope,
  readRuleFileForScope,
  writeOwnRuleFileForScope,
} from '@vynel/skills'
import { NotFoundError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { resolveScopeTarget, workspacePathOf } from '../_shared/resolve-scope-target.js'
import {
  ListRulesResponseSchema,
  ResolvedRulesQuerySchema,
  RuleIdParamSchema,
  RuleRowSchema,
  RuleScopeQuerySchema,
  WriteRuleBodySchema,
} from './schemas.js'
import { serializeRuleFile } from './serializers.js'

const RULE_SCOPE_ARGUMENTS =
  '`scope` is "user" (~/.claude/rules — applies in every workspace) or "workspace" ' +
  '(<workspace>/.claude/rules; + `workspaceId`, defaults to the active workspace; on the global ' +
  'surface there is none, so pass it explicitly).'

export const rulesUserApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['rules'],
      summary: "List every rule file in the user's ~/.claude/rules folder.",
      'x-sdk-name': 'rulesUser.list',
      responses: {
        200: {
          description: 'All rule files (hand-written + marketplace), provenance per row.',
          content: { 'application/json': { schema: resolver(ListRulesResponseSchema) } },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const rules = listAllRuleFilesForScope('user')
      return c.json({ rules: rules.map((rule) => serializeRuleFile(rule, 'user')) })
    },
  )
  // Declared before `/:ruleId` so the static segment is never read as an id.
  .get(
    '/resolved',
    describeRoute({
      tags: ['rules'],
      summary: "List every rule a session follows: the user folder ∪ one workspace's.",
      'x-sdk-name': 'rules.listResolved',
      'x-mcp': {
        exposed: true,
        name: 'list_rules',
        description:
          "List the standing rules Claude follows — every rule file in the user's ~/.claude/rules " +
          '(scope "user", applies in every workspace) plus the workspace\'s own .claude/rules when ' +
          '`workspaceId` is set (defaults to the active workspace; omit on the global surface). Each ' +
          'row: ruleId (the file name), title, the full markdown content, scope, and marketplace ' +
          'provenance (non-null = installed from the Marketplace and still managed by it). These ' +
          'files already load into your context — use this to see, quote, or check a rule before ' +
          'writing or deleting one. Read-only.',
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: "User-scope rules first, then the workspace's (when workspaceId is given).",
          content: { 'application/json': { schema: resolver(ListRulesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
    }),
    validator('query', ResolvedRulesQuerySchema),
    ...userScoped,
    async (c) => {
      const { workspaceId } = c.req.valid('query')
      const target =
        workspaceId === undefined
          ? null
          : await resolveScopeTarget(c.var.db, c.var.user.id, { scope: 'workspace', workspaceId })
      const rules = [
        ...listAllRuleFilesForScope('user').map((rule) => serializeRuleFile(rule, 'user')),
        ...(target?.scope === 'workspace'
          ? listAllRuleFilesForScope('workspace', target.workspacePath).map((rule) =>
              serializeRuleFile(rule, 'workspace'),
            )
          : []),
      ]
      return c.json({ rules })
    },
  )
  .put(
    '/:ruleId',
    describeRoute({
      tags: ['rules'],
      summary: "Create or replace one of the user's own rule files.",
      'x-sdk-name': 'rules.write',
      'x-mcp': {
        exposed: true,
        name: 'write_rule',
        description:
          'Create or replace ONE rule file — a standing instruction Claude follows in every future ' +
          'session at that scope. `ruleId` becomes `<ruleId>.md` (kebab-case, e.g. "git-hygiene"); ' +
          `${RULE_SCOPE_ARGUMENTS} \`content\` is the whole markdown file (open with a \`# Title\` ` +
          'heading, then the instructions in plain words). Replaces the file entirely — read it ' +
          'with list_rules first when editing. Saving over a Marketplace-installed rule turns it ' +
          "into the user's own copy (Marketplace updates stop applying). Only write a rule when " +
          'the user asked for a standing instruction; a fact about them belongs in memory, not ' +
          'here. Mutating.',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        200: {
          description: 'The rule file as it now reads on disk.',
          content: { 'application/json': { schema: resolver(RuleRowSchema) } },
        },
        400: {
          description:
            'Unsafe rule name, empty or oversized content, or workspaceId missing for the workspace scope.',
        },
        404: { description: 'Workspace not found (or not owned by this user).' },
      },
    }),
    validator('param', RuleIdParamSchema),
    validator('json', WriteRuleBodySchema),
    ...userScoped,
    async (c) => {
      const { ruleId } = c.req.valid('param')
      const body = c.req.valid('json')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, body)
      await writeOwnRuleFileForScope({
        scope: target.scope,
        ruleId,
        content: body.content,
        ...workspacePathOf(target),
      })
      const written = readRuleFileForScope(target.scope, ruleId, target.workspacePath)
      if (written === null) throw new NotFoundError('rule', ruleId)
      return c.json(serializeRuleFile(written, target.scope))
    },
  )
  .delete(
    '/:ruleId',
    describeRoute({
      tags: ['rules'],
      summary: 'Delete one rule file at a scope.',
      'x-sdk-name': 'rules.delete',
      'x-mcp': {
        exposed: true,
        name: 'delete_rule',
        description:
          `Delete ONE rule file by \`ruleId\`. ${RULE_SCOPE_ARGUMENTS} Removes the file from disk — ` +
          "the user's own or a Marketplace install alike — so the rule stops applying to future " +
          'sessions. Irreversible; confirm with the user unless they just asked for exactly this.',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
      },
      responses: {
        204: { description: 'Deleted (no body).' },
        400: { description: 'Unsafe rule name, or workspaceId missing for the workspace scope.' },
        404: { description: 'No such rule file at that scope, or workspace not found.' },
      },
    }),
    validator('param', RuleIdParamSchema),
    validator('query', RuleScopeQuerySchema),
    ...userScoped,
    async (c) => {
      const { ruleId } = c.req.valid('param')
      const target = await resolveScopeTarget(c.var.db, c.var.user.id, c.req.valid('query'))
      await deleteOwnRuleFileForScope({ scope: target.scope, ruleId, ...workspacePathOf(target) })
      return c.body(null, 204)
    },
  )
