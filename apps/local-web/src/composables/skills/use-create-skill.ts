import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { skillsKeys } from "./skills-keys.js";
import type { VynelClient } from "@vynel/sdk";

type CreateSkillBody = Parameters<VynelClient["skills"]["create"]>[0];

/** Create one of the user's OWN skills — a new folder with its SKILL.md
 *  rendered from the dialog's parts. */
export function useCreateSkill() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillBody) => vynel.skills.create(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsKeys.all }),
  });
}
