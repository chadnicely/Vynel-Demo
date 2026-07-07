import { describe, expect, it, vi } from "vitest";
import { SdkError } from "@vynel/sdk";
import { createAppQueryClient } from "./vue-query.js";

function makeGateError(): SdkError {
  return new SdkError(new Response(null, { status: 412 }), {
    code: "onboarding_required",
    message: "Complete setup first.",
    inProgressRunId: null,
  });
}

describe("createAppQueryClient", () => {
  it("reports a query failing with the first-launch 412", async () => {
    const onOnboardingRequired = vi.fn();
    const queryClient = createAppQueryClient({ onOnboardingRequired });

    await expect(
      queryClient.fetchQuery({
        queryKey: ["gated"],
        queryFn: () => Promise.reject(makeGateError()),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(SdkError);

    expect(onOnboardingRequired).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for ordinary failures", async () => {
    const onOnboardingRequired = vi.fn();
    const queryClient = createAppQueryClient({ onOnboardingRequired });

    await expect(
      queryClient.fetchQuery({
        queryKey: ["broken"],
        queryFn: () => Promise.reject(new Error("boom")),
        retry: false,
      }),
    ).rejects.toThrow("boom");

    expect(onOnboardingRequired).not.toHaveBeenCalled();
  });
});
