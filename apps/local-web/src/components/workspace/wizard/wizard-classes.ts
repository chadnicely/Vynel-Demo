// The wizard screens' shared looks — one home, so twelve screens read as one
// room. Tailwind utilities over the app's tokens (ink / hair / panel / gold).

export const KICKER =
  "text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3";
export const KICKER_GOLD =
  "text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gold";
export const FIELD_LABEL = "text-[11.5px] font-semibold text-ink-2";
export const HINT = "text-[11.5px] leading-relaxed text-ink-3";
export const INPUT =
  "w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus:border-gold";
export const TEXTAREA = `${INPUT} min-h-[88px] resize-y leading-relaxed`;
export const CARD = "rounded-md border border-hair bg-panel p-3.5";
export const CALLOUT =
  "rounded-md border-l-2 border-gold bg-gold-soft px-3.5 py-3";
export const ROW_BUTTON =
  "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[12.5px] text-ink-1 transition hover:bg-row-hover";
export const SMALL_BUTTON =
  "inline-flex cursor-default items-center gap-1.5 rounded-sm border border-hair-strong px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-55";
export const PRIMARY_BUTTON =
  "inline-flex cursor-default items-center gap-1.5 rounded-sm bg-gold px-3.5 py-1.5 text-[12px] font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55";
export const TICK_BOX =
  "grid size-4 shrink-0 place-items-center rounded-[3px] border border-hair-strong text-shell";
export const TICK_BOX_ON = "border-gold bg-gold";
