import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { formatBytesLikeExplorer } from "../filesystem/file-system-path.js";

export type LocalModelTone = "ok" | "muted" | "live" | "danger";

export interface LocalModelStateCopy {
  /** The badge: Installed · Not downloaded · Downloading · Failed. */
  label: string;
  tone: LocalModelTone;
  /** The line under the badge: the size, the bytes so far, or the error. */
  detail: string;
  /** 0–1 while downloading with a known total; null otherwise. */
  fraction: number | null;
}

// One reading of a model's state for every card — the wording a non-technical
// person needs, never the wire enum.
export function describeLocalModelState(model: LocalModelStatusResponse): LocalModelStateCopy {
  const size = formatBytesLikeExplorer(model.approxBytes);
  switch (model.state) {
    case "installed":
      return { label: "Installed", tone: "ok", detail: size, fraction: null };
    case "downloading": {
      const bytes = model.download?.bytes ?? 0;
      const total = model.download?.total ?? null;
      return {
        label: "Downloading",
        tone: "live",
        detail:
          total === null
            ? `${formatBytesLikeExplorer(bytes)} so far`
            : `${formatBytesLikeExplorer(bytes)} of ${formatBytesLikeExplorer(total)}`,
        fraction: total === null || total === 0 ? null : Math.min(1, bytes / total),
      };
    }
    case "failed":
      return {
        label: "Failed",
        tone: "danger",
        detail: model.download?.error ?? "The download did not finish.",
        fraction: null,
      };
    case "missing":
      return { label: "Not downloaded", tone: "muted", detail: `${size} download`, fraction: null };
  }
}
