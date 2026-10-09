"use client";

/**
 * ScopePicker (Wave 9C)
 * --------------------------------------------------------------------------
 * Topbar indicator + (optional) quick-switcher for the currently-selected
 * club / district / zone. Used inside ClubAdminShell, DashboardShell, and
 * any future admin shell that needs to surface "which scope am I acting on".
 *
 * Behaviour:
 *   - If `items.length <= 1`  → renders the single item's name as quiet text
 *                               (or nothing if the list is empty).
 *   - If `items.length > 1`   → renders a small dropdown button (label +
 *                               chevron) that lists every accessible item;
 *                               clicking one calls `onSelect(id)`.
 *
 * Visual style matches the topbar (h-14, white bg, slate text). Intentionally
 * compact so it doesn't crowd pageTitle. Keep this component generic — it
 * doesn't know whether it's listing clubs or districts; the consumer passes
 * a `label` for the header (e.g. "Club" / "District") and a list of
 * `{ id, name }`.
 */

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScopePickerItem {
  id: number;
  name: string;
}

export interface ScopePickerProps {
  /** Short label shown before the value, e.g. "Club" or "District". Optional. */
  label?: string;
  /** All scopes the user can act on. */
  items: ScopePickerItem[];
  /** Currently-selected id (null = nothing chosen → falls back to first). */
  selectedId: number | null;
  /** Called when the user picks an item from the dropdown. */
  onSelect: (id: number) => void;
}

export default function ScopePicker({
  label,
  items,
  selectedId,
  onSelect,
}: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!items || items.length === 0) return null;

  const selected =
    items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  if (!selected) return null;

  // Single-scope user — read-only text, no dropdown affordance.
  if (items.length <= 1) {
    return (
      <span className="hidden sm:flex items-center gap-1.5 text-sm text-slate-500 max-w-[320px] truncate">
        {label && (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {label}
          </span>
        )}
        {/* Bigger + branded blue per user request 2026-06-12. */}
        <span className="font-bold text-base text-blue-700 truncate">
          {selected.name}
        </span>
      </span>
    );
  }

  // Multi-scope user — clickable dropdown.
  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
          "border border-slate-200 hover:border-slate-300 hover:bg-slate-50",
          "transition-colors max-w-[320px]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label && (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {label}
          </span>
        )}
        {/* Bigger + branded blue per user request 2026-06-12. */}
        <span className="font-bold text-base text-blue-700 truncate">
          {selected.name}
        </span>
        <ChevronDown size={14} className="text-blue-700 flex-shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute right-0 mt-1 z-50 min-w-[240px] max-w-[320px]",
            "bg-white border border-slate-200 rounded-md shadow-lg",
            "py-1 max-h-72 overflow-y-auto",
          )}
        >
          {items.map((item) => {
            const isSelected = item.id === selected.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs",
                  "hover:bg-slate-50 transition-colors",
                  isSelected && "bg-amber-50",
                )}
              >
                <span
                  className={cn(
                    "truncate",
                    isSelected ? "font-semibold text-slate-900" : "text-slate-700",
                  )}
                >
                  {item.name}
                </span>
                {isSelected && (
                  <Check size={14} className="text-amber-600 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
