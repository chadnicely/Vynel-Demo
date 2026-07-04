// GENERATED — DO NOT EDIT
//
// Auto-emitted by `scripts/src/generators/generate-namespaced-sdk.ts`
// from `packages/sdk/openapi.json`'s `x-sdk-name` annotations.
// Regenerate via `pnpm api:generate`. Drift is caught by
// `scripts/src/generators/check-sdk-parity.ts`. NEVER hand-edit.
//
// The namespaced SDK facade — the `client.knowledge.search()` shape on
// top of the openapi-fetch runtime, composed into `createVynelClient`
// via `Object.assign` so the path-keyed surface (`client.GET(...)`) and
// the namespaced surface coexist on one instance, sharing config.
//
// Method signatures derive their types via indexed access on the flat
// `paths` type — zero duplication. Methods throw `SdkError` on non-2xx;
// the path-keyed surface keeps returning `{ data, error }`.

import type { Client } from 'openapi-fetch'
import { SdkError } from '../errors.js'
import type { paths } from './api.js'

export function makeNamespaced(client: Client<paths>) {
  return {
  approvals: {
  decide: async (providerApprovalId: string, input: NonNullable<paths["/approvals/{providerApprovalId}/decide"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/approvals/{providerApprovalId}/decide", {
      params: { path: { providerApprovalId: providerApprovalId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listPending: async () => {
    const { data, error, response } = await client["GET"]("/approvals/pending")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  channels: {
  addAllowedSender: async (workspaceId: string, channelId: string, input: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  connect: async (workspaceId: string, input: NonNullable<paths["/workspaces/{workspaceId}/channels/connect"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/connect", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disable: async (workspaceId: string, channelId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/disable", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disconnect: async (workspaceId: string, channelId: string) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/channels/{channelId}", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error) throw new SdkError(response, error)

  },
  enable: async (workspaceId: string, channelId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/enable", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  history: async (workspaceId: string, channelId: string, options?: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/history"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels/{channelId}/history", {
      params: { path: { workspaceId: workspaceId, channelId: channelId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAllowedSenders: async (workspaceId: string, channelId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeAllowedSender: async (workspaceId: string, channelId: string, senderLinkId: string) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}", {
      params: { path: { workspaceId: workspaceId, channelId: channelId, senderLinkId: senderLinkId } },
    })
    if (error) throw new SdkError(response, error)

  },
  },
  channelsUser: {
  addAllowedSender: async (channelId: string, input: NonNullable<paths["/channels/{channelId}/allowed-senders"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/allowed-senders", {
      params: { path: { channelId: channelId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  connect: async (input: NonNullable<paths["/channels"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/channels", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disable: async (channelId: string) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/disable", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disconnect: async (channelId: string) => {
    const { error, response } = await client["DELETE"]("/channels/{channelId}", {
      params: { path: { channelId: channelId } },
    })
    if (error) throw new SdkError(response, error)

  },
  enable: async (channelId: string) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/enable", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  get: async (channelId: string) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  history: async (channelId: string, options?: NonNullable<paths["/channels/{channelId}/history"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}/history", {
      params: { path: { channelId: channelId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async () => {
    const { data, error, response } = await client["GET"]("/channels")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAllowedSenders: async (channelId: string) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}/allowed-senders", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeAllowedSender: async (channelId: string, senderLinkId: string) => {
    const { error, response } = await client["DELETE"]("/channels/{channelId}/allowed-senders/{senderLinkId}", {
      params: { path: { channelId: channelId, senderLinkId: senderLinkId } },
    })
    if (error) throw new SdkError(response, error)

  },
  },
  knowledge: {
  addDirectory: async (workspaceId: string, input: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/knowledge/sources", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getDocument: async (workspaceId: string, documentId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/documents/{documentId}", {
      params: { path: { workspaceId: workspaceId, documentId: documentId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getStatus: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/status", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDocuments: async (workspaceId: string, options?: NonNullable<paths["/workspaces/{workspaceId}/knowledge/documents"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/documents", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listSources: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/sources", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  reindex: async (workspaceId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/knowledge/reindex", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeSource: async (workspaceId: string, sourceId: string) => {
    const { data, error, response } = await client["DELETE"]("/workspaces/{workspaceId}/knowledge/sources/{sourceId}", {
      params: { path: { workspaceId: workspaceId, sourceId: sourceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  search: async (workspaceId: string, options: NonNullable<paths["/workspaces/{workspaceId}/knowledge/search"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/search", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  marketplace: {
  getItem: async (workspaceId: string, itemId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/marketplace/items/{itemId}", {
      params: { path: { workspaceId: workspaceId, itemId: itemId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listItems: async (workspaceId: string, options?: NonNullable<paths["/workspaces/{workspaceId}/marketplace/items"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/marketplace/items", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  schedules: {
  create: async (workspaceId: string, input: NonNullable<paths["/workspaces/{workspaceId}/schedules"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (workspaceId: string, scheduleId: string) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/schedules/{scheduleId}", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error) throw new SdkError(response, error)

  },
  disable: async (workspaceId: string, scheduleId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules/{scheduleId}/disable", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (workspaceId: string, scheduleId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules/{scheduleId}/enable", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listRuns: async (workspaceId: string, scheduleId: string, options?: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/runs"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules/{scheduleId}/runs", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listTemplates: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules/templates", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: string, scheduleId: string, input: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/schedules/{scheduleId}", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  schedulesUser: {
  create: async (input: NonNullable<paths["/schedules"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/schedules", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (scheduleId: string) => {
    const { error, response } = await client["DELETE"]("/schedules/{scheduleId}", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error) throw new SdkError(response, error)

  },
  disable: async (scheduleId: string) => {
    const { data, error, response } = await client["POST"]("/schedules/{scheduleId}/disable", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (scheduleId: string) => {
    const { data, error, response } = await client["POST"]("/schedules/{scheduleId}/enable", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async () => {
    const { data, error, response } = await client["GET"]("/schedules")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listRuns: async (scheduleId: string, options?: NonNullable<paths["/schedules/{scheduleId}/runs"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/schedules/{scheduleId}/runs", {
      params: { path: { scheduleId: scheduleId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (scheduleId: string, input: NonNullable<paths["/schedules/{scheduleId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/schedules/{scheduleId}", {
      params: { path: { scheduleId: scheduleId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  skills: {
  disable: async (workspaceId: string, installedSkillId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/disable", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (workspaceId: string, installedSkillId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/enable", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  install: async (workspaceId: string, input: NonNullable<paths["/workspaces/{workspaceId}/skills/install"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/install", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAvailable: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/skills/available", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listInstalled: async (workspaceId: string) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/skills/installed", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  synchronize: async (workspaceId: string) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/synchronize", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  uninstall: async (workspaceId: string, installedSkillId: string) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error) throw new SdkError(response, error)

  },
  updateSettings: async (workspaceId: string, installedSkillId: string, input: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
}
}
