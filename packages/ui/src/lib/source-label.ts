// A report row's sourceLabel is PERSONA-FIRST: "<persona> · <workspace>"
// ("James · Claw Launcher"), or a bare persona for global colleagues. The
// workspace is the LAST " · " segment — a passing test once defended the
// inverted read, so this split is the ONE home for both ends (the author
// line's persona part + the workspace badge's name).

export function splitSourceLabel(label: string): {
  persona: string;
  workspace: string | null;
} {
  const separator = label.lastIndexOf(" · ");
  if (separator === -1) return { persona: label, workspace: null };
  return {
    persona: label.slice(0, separator),
    workspace: label.slice(separator + 3),
  };
}
