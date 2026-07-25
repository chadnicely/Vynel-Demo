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
  activity: {
  stream: async () => {
    const { data, error, response } = await client["GET"]("/activity/stream")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  agents: {
  create: async (input: NonNullable<paths["/agents"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/agents", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (agentId: NonNullable<paths["/agents/{agentId}"]["delete"]['parameters']>['path']["agentId"]) => {
    const { error, response } = await client["DELETE"]("/agents/{agentId}", {
      params: { path: { agentId: agentId } },
    })
    if (error) throw new SdkError(response, error)

  },
  getBySlug: async (slug: NonNullable<paths["/agents/{slug}"]["get"]['parameters']>['path']["slug"], options?: NonNullable<paths["/agents/{slug}"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/agents/{slug}", {
      params: { path: { slug: slug }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  installCurated: async (input: NonNullable<paths["/agents/curated/install"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/agents/curated/install", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (options?: NonNullable<paths["/agents"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/agents", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listCurated: async () => {
    const { data, error, response } = await client["GET"]("/agents/curated")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  setEnabled: async (agentId: NonNullable<paths["/agents/{agentId}/enable"]["post"]['parameters']>['path']["agentId"], input: NonNullable<paths["/agents/{agentId}/enable"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/agents/{agentId}/enable", {
      params: { path: { agentId: agentId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (agentId: NonNullable<paths["/agents/{agentId}"]["patch"]['parameters']>['path']["agentId"], input: NonNullable<paths["/agents/{agentId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/agents/{agentId}", {
      params: { path: { agentId: agentId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  approvalRules: {
  delete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/approval-rules/{ruleId}"]["delete"]['parameters']>['path']["workspaceId"], ruleId: NonNullable<paths["/workspaces/{workspaceId}/approval-rules/{ruleId}"]["delete"]['parameters']>['path']["ruleId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/approval-rules/{ruleId}", {
      params: { path: { workspaceId: workspaceId, ruleId: ruleId } },
    })
    if (error) throw new SdkError(response, error)

  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/approval-rules"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/approval-rules", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  approvals: {
  decide: async (providerApprovalId: NonNullable<paths["/approvals/{providerApprovalId}/decide"]["post"]['parameters']>['path']["providerApprovalId"], input: NonNullable<paths["/approvals/{providerApprovalId}/decide"]["post"]['requestBody']>['content']['application/json']) => {
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
  approvalsWorkspace: {
  decide: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/approvals/{providerApprovalId}/decide"]["post"]['parameters']>['path']["workspaceId"], providerApprovalId: NonNullable<paths["/workspaces/{workspaceId}/approvals/{providerApprovalId}/decide"]["post"]['parameters']>['path']["providerApprovalId"], input: NonNullable<paths["/workspaces/{workspaceId}/approvals/{providerApprovalId}/decide"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/approvals/{providerApprovalId}/decide", {
      params: { path: { workspaceId: workspaceId, providerApprovalId: providerApprovalId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listPending: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/approvals/pending"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/approvals/pending", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listRecent: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/approvals/recent"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/approvals/recent"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/approvals/recent", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  asks: {
  answer: async (askId: NonNullable<paths["/asks/{askId}/answer"]["post"]['parameters']>['path']["askId"], input: NonNullable<paths["/asks/{askId}/answer"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/asks/{askId}/answer", {
      params: { path: { askId: askId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  dismiss: async (askId: NonNullable<paths["/asks/{askId}/dismiss"]["post"]['parameters']>['path']["askId"]) => {
    const { data, error, response } = await client["POST"]("/asks/{askId}/dismiss", {
      params: { path: { askId: askId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listPending: async () => {
    const { data, error, response } = await client["GET"]("/asks/pending")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  capabilities: {
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/capabilities"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/capabilities", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  setEnabled: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/capabilities/{capabilityId}"]["put"]['parameters']>['path']["workspaceId"], capabilityId: NonNullable<paths["/workspaces/{workspaceId}/capabilities/{capabilityId}"]["put"]['parameters']>['path']["capabilityId"], input: NonNullable<paths["/workspaces/{workspaceId}/capabilities/{capabilityId}"]["put"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PUT"]("/workspaces/{workspaceId}/capabilities/{capabilityId}", {
      params: { path: { workspaceId: workspaceId, capabilityId: capabilityId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  channels: {
  addAllowedSender: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["post"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["post"]['parameters']>['path']["channelId"], input: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  connect: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/connect"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/channels/connect"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/connect", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/disable"]["post"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/disable"]["post"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/disable", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disconnect: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}"]["delete"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}"]["delete"]['parameters']>['path']["channelId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/channels/{channelId}", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error) throw new SdkError(response, error)

  },
  enable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/enable"]["post"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/enable"]["post"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/channels/{channelId}/enable", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  history: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/history"]["get"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/history"]["get"]['parameters']>['path']["channelId"], options?: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/history"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels/{channelId}/history", {
      params: { path: { workspaceId: workspaceId, channelId: channelId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAllowedSenders: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["get"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders"]["get"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders", {
      params: { path: { workspaceId: workspaceId, channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeAllowedSender: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}"]["delete"]['parameters']>['path']["workspaceId"], channelId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}"]["delete"]['parameters']>['path']["channelId"], senderLinkId: NonNullable<paths["/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}"]["delete"]['parameters']>['path']["senderLinkId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/channels/{channelId}/allowed-senders/{senderLinkId}", {
      params: { path: { workspaceId: workspaceId, channelId: channelId, senderLinkId: senderLinkId } },
    })
    if (error) throw new SdkError(response, error)

  },
  },
  channelsUser: {
  addAllowedSender: async (channelId: NonNullable<paths["/channels/{channelId}/allowed-senders"]["post"]['parameters']>['path']["channelId"], input: NonNullable<paths["/channels/{channelId}/allowed-senders"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/allowed-senders", {
      params: { path: { channelId: channelId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  approveGroup: async (channelId: NonNullable<paths["/channels/{channelId}/groups/{groupId}/approve"]["post"]['parameters']>['path']["channelId"], groupId: NonNullable<paths["/channels/{channelId}/groups/{groupId}/approve"]["post"]['parameters']>['path']["groupId"]) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/groups/{groupId}/approve", {
      params: { path: { channelId: channelId, groupId: groupId } },
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
  disable: async (channelId: NonNullable<paths["/channels/{channelId}/disable"]["post"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/disable", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  disconnect: async (channelId: NonNullable<paths["/channels/{channelId}"]["delete"]['parameters']>['path']["channelId"]) => {
    const { error, response } = await client["DELETE"]("/channels/{channelId}", {
      params: { path: { channelId: channelId } },
    })
    if (error) throw new SdkError(response, error)

  },
  enable: async (channelId: NonNullable<paths["/channels/{channelId}/enable"]["post"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/enable", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  get: async (channelId: NonNullable<paths["/channels/{channelId}"]["get"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  history: async (channelId: NonNullable<paths["/channels/{channelId}/history"]["get"]['parameters']>['path']["channelId"], options?: NonNullable<paths["/channels/{channelId}/history"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}/history", {
      params: { path: { channelId: channelId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  ignoreGroup: async (channelId: NonNullable<paths["/channels/{channelId}/groups/{groupId}/ignore"]["post"]['parameters']>['path']["channelId"], groupId: NonNullable<paths["/channels/{channelId}/groups/{groupId}/ignore"]["post"]['parameters']>['path']["groupId"]) => {
    const { data, error, response } = await client["POST"]("/channels/{channelId}/groups/{groupId}/ignore", {
      params: { path: { channelId: channelId, groupId: groupId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async () => {
    const { data, error, response } = await client["GET"]("/channels")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAllowedSenders: async (channelId: NonNullable<paths["/channels/{channelId}/allowed-senders"]["get"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}/allowed-senders", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listGroups: async (channelId: NonNullable<paths["/channels/{channelId}/groups"]["get"]['parameters']>['path']["channelId"]) => {
    const { data, error, response } = await client["GET"]("/channels/{channelId}/groups", {
      params: { path: { channelId: channelId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeAllowedSender: async (channelId: NonNullable<paths["/channels/{channelId}/allowed-senders/{senderLinkId}"]["delete"]['parameters']>['path']["channelId"], senderLinkId: NonNullable<paths["/channels/{channelId}/allowed-senders/{senderLinkId}"]["delete"]['parameters']>['path']["senderLinkId"]) => {
    const { error, response } = await client["DELETE"]("/channels/{channelId}/allowed-senders/{senderLinkId}", {
      params: { path: { channelId: channelId, senderLinkId: senderLinkId } },
    })
    if (error) throw new SdkError(response, error)

  },
  rename: async (channelId: NonNullable<paths["/channels/{channelId}"]["patch"]['parameters']>['path']["channelId"], input: NonNullable<paths["/channels/{channelId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/channels/{channelId}", {
      params: { path: { channelId: channelId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  setGroupPolicy: async (channelId: NonNullable<paths["/channels/{channelId}/groups/{groupId}"]["patch"]['parameters']>['path']["channelId"], groupId: NonNullable<paths["/channels/{channelId}/groups/{groupId}"]["patch"]['parameters']>['path']["groupId"], input: NonNullable<paths["/channels/{channelId}/groups/{groupId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/channels/{channelId}/groups/{groupId}", {
      params: { path: { channelId: channelId, groupId: groupId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  chat: {
  archiveSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/archive"]["post"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/archive"]["post"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}/archive", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  deleteSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["delete"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["delete"]['parameters']>['path']["sessionId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error) throw new SdkError(response, error)

  },
  getContinuing: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/continuing"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/continuing", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["get"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["get"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getSessionContext: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/context"]["get"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/context"]["get"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}/context", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getSessionImage: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/images/{filename}"]["get"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/images/{filename}"]["get"]['parameters']>['path']["sessionId"], filename: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/images/{filename}"]["get"]['parameters']>['path']["filename"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}/images/{filename}", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId, filename: filename } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  interruptSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/interrupt"]["post"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/interrupt"]["post"]['parameters']>['path']["sessionId"]) => {
    const { error, response } = await client["POST"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}/interrupt", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error) throw new SdkError(response, error)

  },
  listSessions: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/sessions", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  renameSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["patch"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["patch"]['parameters']>['path']["sessionId"], input: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  searchSessions: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/search"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/search"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/chat/sessions/search", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  startTurn: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/turn"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/turn"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/chat/sessions/turn", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  unarchiveSession: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/unarchive"]["post"]['parameters']>['path']["workspaceId"], sessionId: NonNullable<paths["/workspaces/{workspaceId}/chat/sessions/{sessionId}/unarchive"]["post"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/chat/sessions/{sessionId}/unarchive", {
      params: { path: { workspaceId: workspaceId, sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  dashboard: {
  getOverview: async () => {
    const { data, error, response } = await client["GET"]("/dashboard/overview")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  files: {
  createDirectory: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/directory"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/files/directory"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/files/directory", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  createFile: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/file"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/files/file"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/files/file", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/delete"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/files/delete"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/files/delete", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listActivity: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/activity"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/files/activity"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/files/activity", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listFileHistory: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/activity/file"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/files/activity/file"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/files/activity/file", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  move: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/move"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/files/move"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/files/move", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  raw: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/raw"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/files/raw"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/files/raw", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  readContent: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/content"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/files/content"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/files/content", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  saveContent: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/content"]["put"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/files/content"]["put"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PUT"]("/workspaces/{workspaceId}/files/content", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  tree: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/files/tree"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/files/tree"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/files/tree", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  hub: {
  getSession: async () => {
    const { data, error, response } = await client["GET"]("/hub/session")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDevices: async () => {
    const { data, error, response } = await client["GET"]("/hub/devices")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  revokeDevice: async (deviceId: NonNullable<paths["/hub/devices/{deviceId}"]["delete"]['parameters']>['path']["deviceId"]) => {
    const { data, error, response } = await client["DELETE"]("/hub/devices/{deviceId}", {
      params: { path: { deviceId: deviceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  signIn: async (input: NonNullable<paths["/hub/sign-in"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/hub/sign-in", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  signOut: async () => {
    const { data, error, response } = await client["POST"]("/hub/sign-out")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  journal: {
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/journal"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/journal"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/journal", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/journal"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/journal"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/journal", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  journalUser: {
  create: async (input: NonNullable<paths["/journal"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/journal", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (entryId: NonNullable<paths["/journal/{entryId}"]["delete"]['parameters']>['path']["entryId"]) => {
    const { error, response } = await client["DELETE"]("/journal/{entryId}", {
      params: { path: { entryId: entryId } },
    })
    if (error) throw new SdkError(response, error)

  },
  list: async (options?: NonNullable<paths["/journal"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/journal", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (entryId: NonNullable<paths["/journal/{entryId}"]["patch"]['parameters']>['path']["entryId"], input: NonNullable<paths["/journal/{entryId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/journal/{entryId}", {
      params: { path: { entryId: entryId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  knowledge: {
  addSource: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/knowledge/sources", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getDocument: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/documents/{documentId}"]["get"]['parameters']>['path']["workspaceId"], documentId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/documents/{documentId}"]["get"]['parameters']>['path']["documentId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/documents/{documentId}", {
      params: { path: { workspaceId: workspaceId, documentId: documentId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getStatus: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/status"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/status", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDocuments: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/documents"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/knowledge/documents"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/documents", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listSources: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/sources", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  reindex: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/reindex"]["post"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/knowledge/reindex", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  removeSource: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources/{sourceId}"]["delete"]['parameters']>['path']["workspaceId"], sourceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/sources/{sourceId}"]["delete"]['parameters']>['path']["sourceId"]) => {
    const { data, error, response } = await client["DELETE"]("/workspaces/{workspaceId}/knowledge/sources/{sourceId}", {
      params: { path: { workspaceId: workspaceId, sourceId: sourceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  search: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/knowledge/search"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/knowledge/search"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/knowledge/search", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  marketplace: {
  getItem: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/marketplace/items/{itemId}"]["get"]['parameters']>['path']["workspaceId"], itemId: NonNullable<paths["/workspaces/{workspaceId}/marketplace/items/{itemId}"]["get"]['parameters']>['path']["itemId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/marketplace/items/{itemId}", {
      params: { path: { workspaceId: workspaceId, itemId: itemId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  install: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/marketplace/install"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/marketplace/install"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/marketplace/install", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listItems: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/marketplace/items"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/marketplace/items"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/marketplace/items", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  uninstall: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/marketplace/uninstall"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/marketplace/uninstall"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/marketplace/uninstall", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  marketplaceUser: {
  install: async (input: NonNullable<paths["/marketplace/install"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/marketplace/install", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listItems: async (options?: NonNullable<paths["/marketplace/items"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/marketplace/items", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  uninstall: async (input: NonNullable<paths["/marketplace/uninstall"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/marketplace/uninstall", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  memory: {
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/memory/entries"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/memory/entries", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["delete"]['parameters']>['path']["workspaceId"], entryId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["delete"]['parameters']>['path']["entryId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/memory/entries/{entryId}", {
      params: { path: { workspaceId: workspaceId, entryId: entryId } },
    })
    if (error) throw new SdkError(response, error)

  },
  get: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["get"]['parameters']>['path']["workspaceId"], entryId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["get"]['parameters']>['path']["entryId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/memory/entries/{entryId}", {
      params: { path: { workspaceId: workspaceId, entryId: entryId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  importFile: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/from-file"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/from-file"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/memory/entries/from-file", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/memory/entries"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/memory/entries", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listMentions: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}/mentions"]["get"]['parameters']>['path']["workspaceId"], entryId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}/mentions"]["get"]['parameters']>['path']["entryId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/memory/entries/{entryId}/mentions", {
      params: { path: { workspaceId: workspaceId, entryId: entryId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listTags: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/tags"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/memory/tags", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  search: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/search"]["get"]['parameters']>['path']["workspaceId"], options: NonNullable<paths["/workspaces/{workspaceId}/memory/search"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/memory/search", {
      params: { path: { workspaceId: workspaceId }, query: options },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["patch"]['parameters']>['path']["workspaceId"], entryId: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["patch"]['parameters']>['path']["entryId"], input: NonNullable<paths["/workspaces/{workspaceId}/memory/entries/{entryId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/memory/entries/{entryId}", {
      params: { path: { workspaceId: workspaceId, entryId: entryId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  monitors: {
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/monitors"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/monitors"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/monitors", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/monitors"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/monitors"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/monitors", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  stop: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/monitors/{monitorId}/stop"]["post"]['parameters']>['path']["workspaceId"], monitorId: NonNullable<paths["/workspaces/{workspaceId}/monitors/{monitorId}/stop"]["post"]['parameters']>['path']["monitorId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/monitors/{monitorId}/stop", {
      params: { path: { workspaceId: workspaceId, monitorId: monitorId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  monitorsUser: {
  create: async (input: NonNullable<paths["/monitors"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/monitors", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (options?: NonNullable<paths["/monitors"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/monitors", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  stop: async (monitorId: NonNullable<paths["/monitors/{monitorId}/stop"]["post"]['parameters']>['path']["monitorId"]) => {
    const { data, error, response } = await client["POST"]("/monitors/{monitorId}/stop", {
      params: { path: { monitorId: monitorId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  notebook: {
  createDocument: async (input: NonNullable<paths["/notebook/documents"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/notebook/documents", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  deleteDocument: async (documentId: NonNullable<paths["/notebook/documents/{documentId}"]["delete"]['parameters']>['path']["documentId"]) => {
    const { error, response } = await client["DELETE"]("/notebook/documents/{documentId}", {
      params: { path: { documentId: documentId } },
    })
    if (error) throw new SdkError(response, error)

  },
  getPlaybook: async (playbookId: NonNullable<paths["/notebook/playbooks/{playbookId}"]["get"]['parameters']>['path']["playbookId"], options?: NonNullable<paths["/notebook/playbooks/{playbookId}"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/notebook/playbooks/{playbookId}", {
      params: { path: { playbookId: playbookId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDocuments: async () => {
    const { data, error, response } = await client["GET"]("/notebook/documents")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listPlaybooks: async (options?: NonNullable<paths["/notebook/playbooks"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/notebook/playbooks", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  updateDocument: async (documentId: NonNullable<paths["/notebook/documents/{documentId}"]["patch"]['parameters']>['path']["documentId"], input: NonNullable<paths["/notebook/documents/{documentId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/notebook/documents/{documentId}", {
      params: { path: { documentId: documentId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  onboarding: {
  getNeedsOnboarding: async () => {
    const { data, error, response } = await client["GET"]("/onboarding/status/needs-onboarding")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getRunStatus: async (runId: NonNullable<paths["/onboarding/{runId}"]["get"]['parameters']>['path']["runId"]) => {
    const { data, error, response } = await client["GET"]("/onboarding/{runId}", {
      params: { path: { runId: runId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  restart: async () => {
    const { data, error, response } = await client["POST"]("/onboarding/restart")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  start: async () => {
    const { data, error, response } = await client["POST"]("/onboarding/start")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  submitStep: async (runId: NonNullable<paths["/onboarding/{runId}/submit"]["post"]['parameters']>['path']["runId"], input: NonNullable<paths["/onboarding/{runId}/submit"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/onboarding/{runId}/submit", {
      params: { path: { runId: runId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  plans: {
  complete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/plans/{planId}/complete"]["post"]['parameters']>['path']["workspaceId"], planId: NonNullable<paths["/workspaces/{workspaceId}/plans/{planId}/complete"]["post"]['parameters']>['path']["planId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/plans/{planId}/complete", {
      params: { path: { workspaceId: workspaceId, planId: planId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/plans"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/plans"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/plans", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/plans"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/plans"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/plans", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/plans/{planId}"]["patch"]['parameters']>['path']["workspaceId"], planId: NonNullable<paths["/workspaces/{workspaceId}/plans/{planId}"]["patch"]['parameters']>['path']["planId"], input: NonNullable<paths["/workspaces/{workspaceId}/plans/{planId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/plans/{planId}", {
      params: { path: { workspaceId: workspaceId, planId: planId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  plansUser: {
  create: async (input: NonNullable<paths["/plans"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/plans", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (planId: NonNullable<paths["/plans/{planId}"]["delete"]['parameters']>['path']["planId"]) => {
    const { error, response } = await client["DELETE"]("/plans/{planId}", {
      params: { path: { planId: planId } },
    })
    if (error) throw new SdkError(response, error)

  },
  list: async (options?: NonNullable<paths["/plans"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/plans", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (planId: NonNullable<paths["/plans/{planId}"]["patch"]['parameters']>['path']["planId"], input: NonNullable<paths["/plans/{planId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/plans/{planId}", {
      params: { path: { planId: planId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  providers: {
  discoverInstalledSkills: async (providerId: NonNullable<paths["/providers/{providerId}/skills"]["get"]['parameters']>['path']["providerId"], options?: NonNullable<paths["/providers/{providerId}/skills"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/providers/{providerId}/skills", {
      params: { path: { providerId: providerId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getAuthStatus: async (providerId: NonNullable<paths["/providers/{providerId}/auth"]["get"]['parameters']>['path']["providerId"]) => {
    const { data, error, response } = await client["GET"]("/providers/{providerId}/auth", {
      params: { path: { providerId: providerId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async () => {
    const { data, error, response } = await client["GET"]("/providers")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  root: {
  getContinuing: async () => {
    const { data, error, response } = await client["GET"]("/root/continuing")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getSession: async (sessionId: NonNullable<paths["/root/sessions/{sessionId}"]["get"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["GET"]("/root/sessions/{sessionId}", {
      params: { path: { sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getTrace: async (partialSessionId: NonNullable<paths["/root/trace/{partialSessionId}"]["get"]['parameters']>['path']["partialSessionId"]) => {
    const { data, error, response } = await client["GET"]("/root/trace/{partialSessionId}", {
      params: { path: { partialSessionId: partialSessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getTranscript: async () => {
    const { data, error, response } = await client["GET"]("/root/transcript")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  interruptTurn: async () => {
    const { data, error, response } = await client["POST"]("/root/turn/interrupt")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDelegations: async () => {
    const { data, error, response } = await client["GET"]("/root/delegations")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  startTurn: async (input: NonNullable<paths["/root/turn"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/root/turn", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  stopDelegation: async (partialSessionId: NonNullable<paths["/root/delegations/{partialSessionId}/stop"]["post"]['parameters']>['path']["partialSessionId"]) => {
    const { data, error, response } = await client["POST"]("/root/delegations/{partialSessionId}/stop", {
      params: { path: { partialSessionId: partialSessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  streamTrace: async (partialSessionId: NonNullable<paths["/root/trace/{partialSessionId}/stream"]["get"]['parameters']>['path']["partialSessionId"]) => {
    const { data, error, response } = await client["GET"]("/root/trace/{partialSessionId}/stream", {
      params: { path: { partialSessionId: partialSessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  routing: {
  delegate: async (input: NonNullable<paths["/routing/delegate"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/routing/delegate", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delegateSession: async (input: NonNullable<paths["/routing/delegate-session"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/routing/delegate-session", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getBackgroundRun: async (jobId: NonNullable<paths["/routing/background-runs/{jobId}"]["get"]['parameters']>['path']["jobId"]) => {
    const { data, error, response } = await client["GET"]("/routing/background-runs/{jobId}", {
      params: { path: { jobId: jobId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listBackgroundRuns: async () => {
    const { data, error, response } = await client["GET"]("/routing/background-runs")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listChannels: async () => {
    const { data, error, response } = await client["GET"]("/routing/channels")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listWorkspaces: async () => {
    const { data, error, response } = await client["GET"]("/routing/workspaces")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  report: async (input: NonNullable<paths["/routing/report"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/routing/report", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  sendToChannel: async (input: NonNullable<paths["/routing/send-to-channel"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/routing/send-to-channel", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  schedules: {
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/schedules"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["delete"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["delete"]['parameters']>['path']["scheduleId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/schedules/{scheduleId}", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error) throw new SdkError(response, error)

  },
  disable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/disable"]["post"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/disable"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules/{scheduleId}/disable", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/enable"]["post"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/enable"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules/{scheduleId}/enable", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  fireNow: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/fire-now"]["post"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/fire-now"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/schedules/{scheduleId}/fire-now", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listRuns: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/runs"]["get"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/runs"]["get"]['parameters']>['path']["scheduleId"], options?: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}/runs"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules/{scheduleId}/runs", {
      params: { path: { workspaceId: workspaceId, scheduleId: scheduleId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listTemplates: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/templates"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/schedules/templates", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["patch"]['parameters']>['path']["workspaceId"], scheduleId: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["patch"]['parameters']>['path']["scheduleId"], input: NonNullable<paths["/workspaces/{workspaceId}/schedules/{scheduleId}"]["patch"]['requestBody']>['content']['application/json']) => {
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
  delete: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}"]["delete"]['parameters']>['path']["scheduleId"]) => {
    const { error, response } = await client["DELETE"]("/schedules/{scheduleId}", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error) throw new SdkError(response, error)

  },
  disable: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}/disable"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/schedules/{scheduleId}/disable", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}/enable"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/schedules/{scheduleId}/enable", {
      params: { path: { scheduleId: scheduleId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  fireNow: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}/fire-now"]["post"]['parameters']>['path']["scheduleId"]) => {
    const { data, error, response } = await client["POST"]("/schedules/{scheduleId}/fire-now", {
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
  listRuns: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}/runs"]["get"]['parameters']>['path']["scheduleId"], options?: NonNullable<paths["/schedules/{scheduleId}/runs"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/schedules/{scheduleId}/runs", {
      params: { path: { scheduleId: scheduleId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (scheduleId: NonNullable<paths["/schedules/{scheduleId}"]["patch"]['parameters']>['path']["scheduleId"], input: NonNullable<paths["/schedules/{scheduleId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/schedules/{scheduleId}", {
      params: { path: { scheduleId: scheduleId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  sessions: {
  createSpawned: async (input: NonNullable<paths["/sessions/spawned"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/sessions/spawned", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  overview: async () => {
    const { data, error, response } = await client["GET"]("/sessions/overview")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  startTurn: async (sessionId: NonNullable<paths["/sessions/{sessionId}/turn"]["post"]['parameters']>['path']["sessionId"], input: NonNullable<paths["/sessions/{sessionId}/turn"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/sessions/{sessionId}/turn", {
      params: { path: { sessionId: sessionId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  streamSession: async (sessionId: NonNullable<paths["/sessions/{sessionId}/stream"]["get"]['parameters']>['path']["sessionId"]) => {
    const { data, error, response } = await client["GET"]("/sessions/{sessionId}/stream", {
      params: { path: { sessionId: sessionId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  skills: {
  disable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/disable"]["post"]['parameters']>['path']["workspaceId"], installedSkillId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/disable"]["post"]['parameters']>['path']["installedSkillId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/disable", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  enable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/enable"]["post"]['parameters']>['path']["workspaceId"], installedSkillId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/enable"]["post"]['parameters']>['path']["installedSkillId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/enable", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  install: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/install"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/skills/install"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/install", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listAvailable: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/available"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/skills/available", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listInstalled: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/skills/installed", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  synchronize: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/synchronize"]["post"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/skills/synchronize", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  uninstall: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}"]["delete"]['parameters']>['path']["workspaceId"], installedSkillId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}"]["delete"]['parameters']>['path']["installedSkillId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
    })
    if (error) throw new SdkError(response, error)

  },
  updateSettings: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings"]["patch"]['parameters']>['path']["workspaceId"], installedSkillId: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings"]["patch"]['parameters']>['path']["installedSkillId"], input: NonNullable<paths["/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/skills/installed/{installedSkillId}/settings", {
      params: { path: { workspaceId: workspaceId, installedSkillId: installedSkillId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  sshServers: {
  add: async (input: NonNullable<paths["/ssh-servers"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/ssh-servers", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async () => {
    const { data, error, response } = await client["GET"]("/ssh-servers")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  remove: async (serverId: NonNullable<paths["/ssh-servers/{serverId}"]["delete"]['parameters']>['path']["serverId"]) => {
    const { error, response } = await client["DELETE"]("/ssh-servers/{serverId}", {
      params: { path: { serverId: serverId } },
    })
    if (error) throw new SdkError(response, error)

  },
  testConnection: async (serverId: NonNullable<paths["/ssh-servers/{serverId}/test-connection"]["post"]['parameters']>['path']["serverId"]) => {
    const { data, error, response } = await client["POST"]("/ssh-servers/{serverId}/test-connection", {
      params: { path: { serverId: serverId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  tasks: {
  complete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/tasks/{taskId}/complete"]["post"]['parameters']>['path']["workspaceId"], taskId: NonNullable<paths["/workspaces/{workspaceId}/tasks/{taskId}/complete"]["post"]['parameters']>['path']["taskId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/tasks/{taskId}/complete", {
      params: { path: { workspaceId: workspaceId, taskId: taskId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  create: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/tasks"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/tasks"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/tasks", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/tasks"]["get"]['parameters']>['path']["workspaceId"], options?: NonNullable<paths["/workspaces/{workspaceId}/tasks"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/tasks", {
      params: { path: { workspaceId: workspaceId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/tasks/{taskId}"]["patch"]['parameters']>['path']["workspaceId"], taskId: NonNullable<paths["/workspaces/{workspaceId}/tasks/{taskId}"]["patch"]['parameters']>['path']["taskId"], input: NonNullable<paths["/workspaces/{workspaceId}/tasks/{taskId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/tasks/{taskId}", {
      params: { path: { workspaceId: workspaceId, taskId: taskId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  tasksUser: {
  create: async (input: NonNullable<paths["/tasks"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/tasks", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (taskId: NonNullable<paths["/tasks/{taskId}"]["delete"]['parameters']>['path']["taskId"]) => {
    const { error, response } = await client["DELETE"]("/tasks/{taskId}", {
      params: { path: { taskId: taskId } },
    })
    if (error) throw new SdkError(response, error)

  },
  list: async (options?: NonNullable<paths["/tasks"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/tasks", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (taskId: NonNullable<paths["/tasks/{taskId}"]["patch"]['parameters']>['path']["taskId"], input: NonNullable<paths["/tasks/{taskId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/tasks/{taskId}", {
      params: { path: { taskId: taskId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  users: {
  getMe: async () => {
    const { data, error, response } = await client["GET"]("/users/me")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  getPreferences: async () => {
    const { data, error, response } = await client["GET"]("/users/me/preferences")
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  updateMe: async (input: NonNullable<paths["/users/me"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/users/me", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  updatePreferences: async (input: NonNullable<paths["/users/me/preferences"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/users/me/preferences", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  voice: {
  speak: async (input: NonNullable<paths["/voice/speak"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/voice/speak", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  workspaceApps: {
  add: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps"]["post"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}/apps"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/apps", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/apps", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  logs: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/logs"]["get"]['parameters']>['path']["workspaceId"], appId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/logs"]["get"]['parameters']>['path']["appId"], options?: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/logs"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}/apps/{appId}/logs", {
      params: { path: { workspaceId: workspaceId, appId: appId }, ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  remove: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}"]["delete"]['parameters']>['path']["workspaceId"], appId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}"]["delete"]['parameters']>['path']["appId"]) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}/apps/{appId}", {
      params: { path: { workspaceId: workspaceId, appId: appId } },
    })
    if (error) throw new SdkError(response, error)

  },
  start: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/start"]["post"]['parameters']>['path']["workspaceId"], appId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/start"]["post"]['parameters']>['path']["appId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/apps/{appId}/start", {
      params: { path: { workspaceId: workspaceId, appId: appId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  stop: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/stop"]["post"]['parameters']>['path']["workspaceId"], appId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}/stop"]["post"]['parameters']>['path']["appId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/apps/{appId}/stop", {
      params: { path: { workspaceId: workspaceId, appId: appId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}"]["patch"]['parameters']>['path']["workspaceId"], appId: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}"]["patch"]['parameters']>['path']["appId"], input: NonNullable<paths["/workspaces/{workspaceId}/apps/{appId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}/apps/{appId}", {
      params: { path: { workspaceId: workspaceId, appId: appId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
  workspaces: {
  archive: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/archive"]["post"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/archive", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  delete: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}"]["delete"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}"]["delete"]['requestBody']>['content']['application/json']) => {
    const { error, response } = await client["DELETE"]("/workspaces/{workspaceId}", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error) throw new SdkError(response, error)

  },
  get: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}"]["get"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["GET"]("/workspaces/{workspaceId}", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  list: async (options?: NonNullable<paths["/workspaces"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  listDirectories: async (options?: NonNullable<paths["/workspaces/directories"]["get"]['parameters']>['query']) => {
    const { data, error, response } = await client["GET"]("/workspaces/directories", {
      params: { ...(options && { query: options }) },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  register: async (input: NonNullable<paths["/workspaces"]["post"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["POST"]("/workspaces", {
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  unarchive: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}/unarchive"]["post"]['parameters']>['path']["workspaceId"]) => {
    const { data, error, response } = await client["POST"]("/workspaces/{workspaceId}/unarchive", {
      params: { path: { workspaceId: workspaceId } },
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  update: async (workspaceId: NonNullable<paths["/workspaces/{workspaceId}"]["patch"]['parameters']>['path']["workspaceId"], input: NonNullable<paths["/workspaces/{workspaceId}"]["patch"]['requestBody']>['content']['application/json']) => {
    const { data, error, response } = await client["PATCH"]("/workspaces/{workspaceId}", {
      params: { path: { workspaceId: workspaceId } },
      body: input,
    })
    if (error || data === undefined) throw new SdkError(response, error ?? data)
    return data
  },
  },
}
}
