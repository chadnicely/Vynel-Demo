import type { Component } from "vue";

// One item model shared by DropdownMenu and ContextMenu — data-driven (items in,
// `select` out) and icon-agnostic (the consumer passes an icon *component*, so
// @vynel/ui never imports an icon set).
export interface MenuItemModel {
  id: string;
  label?: string;
  /** Defaults to "item". */
  kind?: "item" | "separator" | "label" | "checkbox";
  /** A Vue component (e.g. a lucide icon) rendered before the label. */
  icon?: Component;
  /** Right-aligned keyboard-shortcut hint, e.g. "⌘K". */
  shortcut?: string;
  disabled?: boolean;
  /** Destructive framing (delete/remove) — turns the row danger-colored. */
  danger?: boolean;
  /** Only for kind: "checkbox". */
  checked?: boolean;
}

// Tokens-driven Tailwind classes, shared so the two menu surfaces never drift.
// (`@source` scans .ts too, so classes declared here are generated.)
export const menuContentClass =
  "z-50 min-w-[12rem] rounded-md border border-hair bg-raised p-1 text-ink-1 shadow-overlay animate-pop-in";

export const menuItemClass =
  "flex w-full cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm text-ink-1 outline-none transition data-[highlighted]:bg-row-hover data-[highlighted]:text-ink-1 data-[disabled]:pointer-events-none data-[disabled]:text-ink-3";

export const menuItemDangerClass =
  "text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger";

export const menuSeparatorClass = "my-1 h-px bg-hair";

export const menuLabelClass =
  "select-none px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-3";

export const menuShortcutClass =
  "ml-auto pl-4 text-2xs tabular-nums tracking-wider text-ink-3";

export const menuIconClass = "size-4 shrink-0 text-ink-2";
