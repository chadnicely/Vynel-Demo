import { describe, expect, it } from "vitest";
import { SdkError } from "@vynel/sdk";
import { isOnboardingRequiredError } from "./onboarding-required-error.js";

function makeSdkError(status: number, body: unknown): SdkError {
  return new SdkError(new Response(null, { status }), body);
}

describe("isOnboardingRequiredError", () => {
  it("matches the first-launch gate's 412 envelope", () => {
    const error = makeSdkError(412, {
      code: "onboarding_required",
      message: "Complete setup first.",
      inProgressRunId: null,
    });
    expect(isOnboardingRequiredError(error)).toBe(true);
  });

  it("ignores other statuses and other 412 bodies", () => {
    expect(
      isOnboardingRequiredError(
        makeSdkError(404, { code: "onboarding_required" }),
      ),
    ).toBe(false);
    expect(
      isOnboardingRequiredError(
        makeSdkError(412, { code: "precondition_failed" }),
      ),
    ).toBe(false);
    expect(isOnboardingRequiredError(makeSdkError(412, null))).toBe(false);
  });

  it("ignores non-SDK errors", () => {
    expect(isOnboardingRequiredError(new Error("boom"))).toBe(false);
    expect(isOnboardingRequiredError(undefined)).toBe(false);
  });
});
