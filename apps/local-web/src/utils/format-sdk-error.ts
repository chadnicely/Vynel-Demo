import { SdkError } from "@vynel/sdk";

/** One human-readable line for any data-layer failure (letterman convention). */
export function formatSdkError(error: unknown): string {
  if (error instanceof SdkError) {
    return error.message || "The local Vynel service returned an error.";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Something went wrong.";
}
