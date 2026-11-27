import * as React from "react"

import { X } from "@/components/icons"
import { cn } from "@/lib/utils"

// The small buttons that are not a 40px Button (design.md 8.9). Looks live in globals.css `.row-link`, `.row-chip`,
// `.row-clear-btn`, `.row-remove-badge`, `.row-menu-item`; pages pass layout classes only (margins, width).

type Btn = React.ButtonHTMLAttributes<HTMLButtonElement>

/** Text action inside a sentence, a table cell or a card foot ("View", "Remove", "Show all"). */
const LinkButton = React.forwardRef<HTMLButtonElement, Btn & { tone?: "primary" | "danger" | "muted"; size?: "sm" | "md" }>(
  ({ className, tone = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn("row-link", tone !== "primary" && `row-link-${tone}`, size === "sm" && "row-link-sm", className)}
      {...props}
    />
  )
)
LinkButton.displayName = "LinkButton"

/** A button that stays pressed (a filter, a view switch). */
const ToggleButton = React.forwardRef<HTMLButtonElement, Btn & { pressed: boolean }>(
  ({ className, pressed, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} aria-pressed={pressed} className={cn("row-chip", className)} {...props} />
  )
)
ToggleButton.displayName = "ToggleButton"

/** A row of ToggleButtons where one is on. */
function FilterChips<V extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: V; label: React.ReactNode }[]
  value: V
  onChange: (value: V) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => (
        <ToggleButton key={String(o.value)} pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </ToggleButton>
      ))}
    </div>
  )
}

/** The x inside a search or text field. The field needs `relative` on its wrapper and right padding. */
const ClearButton = React.forwardRef<HTMLButtonElement, Btn>(
  ({ className, type = "button", "aria-label": ariaLabel = "Clear", children, ...props }, ref) => (
    <button ref={ref} type={type} aria-label={ariaLabel} className={cn("row-clear-btn", className)} {...props}>
      {children ?? <X size={14} aria-hidden />}
    </button>
  )
)
ClearButton.displayName = "ClearButton"

/** The x on an image or file preview that removes it. Its parent needs `relative`. */
const RemoveBadgeButton = React.forwardRef<HTMLButtonElement, Btn>(
  ({ className, type = "button", "aria-label": ariaLabel = "Remove", children, ...props }, ref) => (
    <button ref={ref} type={type} aria-label={ariaLabel} className={cn("row-remove-badge", className)} {...props}>
      {children ?? <X size={12} aria-hidden />}
    </button>
  )
)
RemoveBadgeButton.displayName = "RemoveBadgeButton"

/** A full-width row in a list or popover (a search result, a club to pick). `tone="dark"` on a navy menu. */
const MenuItemButton = React.forwardRef<HTMLButtonElement, Btn & { selected?: boolean; tone?: "light" | "dark" }>(
  ({ className, selected, tone = "light", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-current={selected || undefined}
      className={cn("row-menu-item", tone === "dark" && "row-menu-item-dark", className)}
      {...props}
    />
  )
)
MenuItemButton.displayName = "MenuItemButton"

/** The dashed box that opens a file picker. `shape="box"` is the square "add photo" tile in a photo grid. */
const UploadZone = React.forwardRef<HTMLButtonElement, Btn & { shape?: "row" | "box" }>(
  ({ className, shape = "row", type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn("row-upload", shape === "box" && "row-upload-box", className)} {...props} />
  )
)
UploadZone.displayName = "UploadZone"

/** A card that is one big button (a report to download, a module to open). Same look as `.row-tile` links. */
const TileButton = React.forwardRef<HTMLButtonElement, Btn>(({ className, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn("row-tile row-tile-btn", className)} {...props} />
))
TileButton.displayName = "TileButton"

/** One day or month in a calendar grid. Blocked or past days are `disabled`. */
const CalendarCell = React.forwardRef<HTMLButtonElement, Btn & { selected?: boolean; today?: boolean; outside?: boolean }>(
  ({ className, selected, today, outside, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected || undefined}
      aria-current={today ? "date" : undefined}
      className={cn("row-cal-cell", today && "row-cal-today", outside && "row-cal-outside", className)}
      {...props}
    />
  )
)
CalendarCell.displayName = "CalendarCell"

/** One-of choice shown as chips, with radio semantics (arrow keys move the choice, like native radios). */
function RadioChips<V extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: V; label: React.ReactNode }[]
  value: V
  onChange: (value: V) => void
  label: string
  className?: string
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const move = (i: number, step: number) => {
    const n = (i + step + options.length) % options.length
    onChange(options[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="row-chip"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1) }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1) }
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export {
  LinkButton,
  ToggleButton,
  FilterChips,
  ClearButton,
  RemoveBadgeButton,
  MenuItemButton,
  UploadZone,
  TileButton,
  CalendarCell,
  RadioChips,
}
