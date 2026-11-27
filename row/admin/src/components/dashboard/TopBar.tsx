import { IconButton } from "@/components/ui/icon-button";
import type { ReactNode } from "react";
import { Menu } from "@/components/icons";

type Props = {
  /** Whose data is on screen: the club, district or area. Page titles live in the page (PageHeader), never here. */
  left?: ReactNode;
  right?: ReactNode;
  onMenu: () => void;
};

/** The one top bar of every signed-in page (design.md 8.2). */
export default function TopBar({ left, right, onMenu }: Props) {
  return (
    <header className="flex min-h-14 flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[color:var(--row-line)] bg-background px-4 py-2 md:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton type="button" className="lg:hidden" aria-label="Open menu" onClick={onMenu}>
          <Menu size={20} />
        </IconButton>
        {left}
      </div>
      {right && <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{right}</div>}
    </header>
  );
}

/** Read-only scope in the top bar, same look as the ScopePicker. */
export function ScopeLabel({ label, name }: { label: string; name: string }) {
  return (
    <span className="flex min-w-0 max-w-[320px] items-baseline gap-2 text-sm">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="truncate font-semibold text-foreground">{name}</span>
    </span>
  );
}
