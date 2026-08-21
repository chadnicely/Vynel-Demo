import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";

// What a `dock`-slot card looks like in a window one row tall. The room draws
// every kind in full; the dock has ~150 px and a corner of someone else's
// screen, so it shows only what can be READ at that size:
//
//   metric  the number and its label — what the dock is for
//   line    a markdown card that is already one line
//   chip    everything else, by name — a table or a chart cannot be read here,
//           so the dock says it exists and the room shows it
//
// Naming the unreadable ones rather than dropping them keeps the promise the
// tool description makes: a card sent to the dock is a card the user sees.

export type DisplayDockCard =
  | { readonly id: string; readonly shape: "metric"; readonly value: string; readonly label: string }
  | { readonly id: string; readonly shape: "line"; readonly text: string }
  | { readonly id: string; readonly shape: "chip"; readonly title: string };

export function displayDockCards(
  widgets: ReadonlyArray<DisplayWidgetView>,
): DisplayDockCard[] {
  return widgets.map((widget) => dockCard(widget));
}

function dockCard(widget: DisplayWidgetView): DisplayDockCard {
  const content = widget.content;
  if (content.kind === "metric") {
    return { id: widget.id, shape: "metric", value: content.value, label: content.label };
  }
  if (content.kind === "markdown") {
    const body = content.body.trim();
    // One line already — no ceiling on its length, because the row ellipsizes
    // and a character count would be a number nobody could defend.
    if (!body.includes("\n")) return { id: widget.id, shape: "line", text: body };
  }
  return { id: widget.id, shape: "chip", title: widget.title };
}
