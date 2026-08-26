import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { skillsKeys } from "./skills-keys.js";
import type { VynelClient } from "@vynel/sdk";

type WriteSkillFileBody = Parameters<VynelClient["skills"]["writeFile"]>[1];
type DeleteSkillFileQuery = Parameters<VynelClient["skills"]["deleteFile"]>[1];
type UninstallSkillQuery = Parameters<VynelClient["skills"]["uninstallByScope"]>[1];

/** Save one text file into a skill's folder (create or replace). */
export function useWriteSkillFile() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { skillId: string; body: WriteSkillFileBody }) =>
      vynel.skills.writeFile(input.skillId, input.body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsKeys.all }),
  });
}

/** Remove one supporting file from a skill's folder. */
export function useDeleteSkillFile() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { skillId: string; query: DeleteSkillFileQuery }) =>
      vynel.skills.deleteFile(input.skillId, input.query),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsKeys.all }),
  });
}

/** Uninstall a skill at a scope — folder and row, gone. */
export function useUninstallSkill() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { skillId: string; query: UninstallSkillQuery }) =>
      vynel.skills.uninstallByScope(input.skillId, input.query),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsKeys.all }),
  });
}
