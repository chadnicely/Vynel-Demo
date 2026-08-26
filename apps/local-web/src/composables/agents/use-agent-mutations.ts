import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { agentsKeys } from "./agents-keys.js";
import type { VynelClient } from "@vynel/sdk";

type CreateAgentBody = Parameters<VynelClient["agents"]["create"]>[0];
type UpdateAgentBody = Parameters<VynelClient["agents"]["update"]>[1];
type InstallCuratedBody = Parameters<VynelClient["agents"]["installCurated"]>[0];
type WriteAgentFileBody = Parameters<VynelClient["agents"]["writeFile"]>[1];
type AgentFileScope = Parameters<VynelClient["agents"]["deleteFile"]>[1];

function useAgentsInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: agentsKeys.all });
}

/** Build a Vynel agent (source "user") — it lands on disk as a mirror too. */
export function useCreateAgent() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (body: CreateAgentBody) => vynel.agents.create(body),
    onSuccess: invalidate,
  });
}

/** Edit a Vynel agent's persona / runtime fields. */
export function useUpdateAgent() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (input: { agentId: string; body: UpdateAgentBody }) =>
      vynel.agents.update(input.agentId, input.body),
    onSuccess: invalidate,
  });
}

/** Delete a Vynel agent (soft-delete + its mirror leaves disk). */
export function useDeleteAgent() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (input: { agentId: string }) => vynel.agents.delete(input.agentId),
    onSuccess: invalidate,
  });
}

/** Install a curated-catalog agent at a scope. */
export function useInstallCuratedAgent() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (body: InstallCuratedBody) => vynel.agents.installCurated(body),
    onSuccess: invalidate,
  });
}

/** Save one hand-authored agent file (raw markdown, create or replace). */
export function useWriteAgentFile() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (input: { slug: string; body: WriteAgentFileBody }) =>
      vynel.agents.writeFile(input.slug, input.body),
    onSuccess: invalidate,
  });
}

/** Delete one hand-authored agent file. */
export function useDeleteAgentFile() {
  const vynel = useVynel();
  const invalidate = useAgentsInvalidation();
  return useMutation({
    mutationFn: (input: { slug: string; scope: AgentFileScope }) =>
      vynel.agents.deleteFile(input.slug, input.scope),
    onSuccess: invalidate,
  });
}
