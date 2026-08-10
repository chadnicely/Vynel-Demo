// Parsing for the desktop PLAN approval card — split from the step presenter
// (which narrates what already happened) because this one feeds the decision
// the user is making before anything happens. Pure; no Vue.

/** A desktop plan parsed off the approval card's tool input — null when the
 *  input isn't plan-shaped (the card then falls back to its generic panes). */
export type DesktopPlanCard = {
  goal: string;
  steps: string[];
  apps: Array<{ app: string; tier: string }>;
};

/** ALL-OR-NOTHING by design: one malformed entry rejects the whole parse (→
 *  generic JSON panes), never a cleaned subset — the plan pane must show
 *  exactly what an approval can arm, structurally, not by trusting the server
 *  validator to have been stricter. */
export function parseDesktopPlanCard(toolInput: unknown): DesktopPlanCard | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const bag = toolInput as Record<string, unknown>;
  const goal = bag["goal"];
  if (typeof goal !== "string" || goal.length === 0) return null;
  const rawSteps = bag["steps"];
  const rawApps = bag["apps"];
  if (!Array.isArray(rawSteps) || !Array.isArray(rawApps)) return null;
  if (rawSteps.length === 0 || rawApps.length === 0) return null;
  const steps: string[] = [];
  for (const step of rawSteps) {
    if (typeof step !== "string" || step.length === 0) return null;
    steps.push(step);
  }
  const apps: Array<{ app: string; tier: string }> = [];
  for (const entry of rawApps) {
    if (typeof entry !== "object" || entry === null) return null;
    const app = (entry as Record<string, unknown>)["app"];
    const tier = (entry as Record<string, unknown>)["tier"];
    if (typeof app !== "string" || app.length === 0 || typeof tier !== "string") return null;
    apps.push({ app, tier });
  }
  return { goal, steps, apps };
}
