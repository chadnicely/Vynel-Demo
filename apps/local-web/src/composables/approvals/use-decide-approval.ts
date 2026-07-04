import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { approvalKeys } from "./approval-keys.js";

export type ApprovalDecisionInput =
  | { providerApprovalId: string; kind: "approved" }
  | { providerApprovalId: string; kind: "denied"; reason: string };

export function useDecideApproval() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalDecisionInput) =>
      vynel.approvals.decide(
        input.providerApprovalId,
        input.kind === "approved"
          ? { kind: "approved" }
          : { kind: "denied", reason: input.reason },
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: approvalKeys.all }),
  });
}
