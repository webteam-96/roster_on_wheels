"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import HelplineBar from "@/components/v2/HelplineBar";
import { PageHeader } from "@/components/row/AppKit";

const DRAWER_EXIT_MS = 180;

type Props = {
  /** A <Sidebar> element. Pass an element, not an inline component, or every render re-mounts the role switcher. */
  sidebar: ReactNode;
  header: ReactNode;
  /** Menu drawer below 1024px. */
  open: boolean;
  onClose: () => void;
  /** For a page without a PageHeader of its own (globals.css `.row-auto-header` hides this one otherwise). */
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
};

/** The frame every dashboard shell shares: sidebar, menu drawer, top bar and the scrolling page. */
export default function ShellFrame({ sidebar, header, open, onClose, title, subtitle, children }: Props) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);

  // Keep the drawer mounted while it slides out.
  const [isDrawerMounted, setIsDrawerMounted] = useState(open);
  if (open && !isDrawerMounted) setIsDrawerMounted(true);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setIsDrawerMounted(false), DRAWER_EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A new page fades in; nothing re-mounts, so page state and layouts are untouched.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    mainRef.current?.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  }, [pathname]);

  return (
    <div className="row-shell fixed inset-0 z-[60] flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-[264px] flex-shrink-0 flex-col border-r border-[color:var(--row-line)] bg-muted lg:flex">
        {sidebar}
      </aside>

      {isDrawerMounted && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            data-state={open ? "open" : "closed"}
            className="absolute inset-0 bg-[#1B2C42]/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:fill-mode-forwards"
            onClick={onClose}
          />
          <aside
            data-state={open ? "open" : "closed"}
            className="relative z-10 flex w-[280px] max-w-[85vw] flex-col border-r border-[color:var(--row-line)] bg-muted data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=closed]:fill-mode-forwards"
          >
            <IconButton aria-label="Close menu" className="absolute right-2 top-2 z-10 h-11 w-11" onClick={onClose}>
              <X size={20} />
            </IconButton>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Support helpline strip, above the header on every dashboard. */}
        <HelplineBar />
        {header}
        <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="row-page">
            {title && <div className="row-auto-header"><PageHeader title={title} description={subtitle} /></div>}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
