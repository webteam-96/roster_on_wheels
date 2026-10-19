"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "@/components/icons";

/**
 * Type-to-filter picker — the same Popover + cmdk Command pattern already used by
 * the district selector on /settings/club-dues/create, lifted into a component so
 * the COG district/year pickers on the club members listing and on the member edit
 * form share one implementation.
 *
 * Used where a plain <Select> would mean scrolling a long list (60+ district
 * numbers, ~50 Rotary years).
 */
export default function SearchableCombo({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  allowClear = false,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  /** Adds a "clear the filter" row at the top — for filter usage, not for required inputs. */
  allowClear?: boolean;
  /** Read-only rendering: shows the current label, never opens. */
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  // When the caller has no option list yet (still loading) fall back to the raw
  // value so a read-only viewer still sees something meaningful.
  const shownLabel = selected ? selected.label : (value || placeholder);

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? () => {} : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={`w-full justify-between font-normal ${disabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : ""} ${className}`}
        >
          <span className={selected || value ? "" : "text-muted-foreground"}>{shownLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {/* cmdk filters on CommandItem's `value`, so the clear-the-filter row
                  carries its visible text — typing "all" still surfaces it. */}
              {allowClear && (
                <CommandItem value={placeholder} onSelect={() => { onChange(""); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === "" ? "opacity-100" : "opacity-0"}`} />
                  {placeholder}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === o.value ? "opacity-100" : "opacity-0"}`} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
