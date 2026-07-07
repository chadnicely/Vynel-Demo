import { SdkError } from "@vynel/sdk";

/** The first-launch gate's 412 envelope (`middleware/first-launch-gate.ts`):
 *  any gated call answering this means setup isn't finished and the wizard
 *  must take over the window. Matching on code + status keeps ordinary 4xx
 *  errors (which views surface inline) out of the wizard path. */
export function isOnboardingRequiredError(error: unknown): boolean {
  return (
    error instanceof SdkError &&
    error.status === 412 &&
    typeof error.body === "object" &&
    error.body !== null &&
    (error.body as { code?: unknown }).code === "onboarding_required"
  );
}
