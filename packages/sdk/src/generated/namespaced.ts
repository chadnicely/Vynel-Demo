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
}
}
