"use client";

import { ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { LogOut, type LucideIcon } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import Glide from "@/components/motion/Glide";
import { cn } from "@/lib/utils";
import DashboardSwitcher from "./DashboardSwitcher";
import { withBase } from "@/lib/basePath";

export interface SidebarNavItem {
  label: string;
  icon?: LucideIcon;
  /** Heading this item sits under; consecutive items with the same group share one heading. */
  group?: string;
  /** Route-link item (active by pathname, or by `activeHref` when given). */
  to?: string;
  /** View-switch item (active by `activeKey`, fires `onSelect`). */
  key?: string;
  /** Set by a caller that knows better than the pathname rule. */
  active?: boolean;
}

export interface SidebarProps {
  brand: string;
  identityName: string;
  identityRole: string;
  initials: string;
  nav: SidebarNavItem[];
  pathname?: string | null;
  /** Pages outside the dashboard's own path (V2 forms) name their menu item. */
  activeHref?: string;
  /** For view-switch navs: the selected key and the handler. */
  activeKey?: string;
  onSelect?: (key: string) => void;
  emptyText?: string;
  footerText: ReactNode;
  switcherTop?: ReactNode;
  switcherKind?: "ag" | "club-admin" | "district-admin" | "goal-oversight" | "super-admin";
  fromSuperAdminSearch?: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
}

// The one sidebar of every dashboard shell (District / Club / AG / Goal oversight). The azure pill glides between items.
export default function Sidebar({
  brand,
  identityName,
  identityRole,
  initials,
  nav,
  pathname,
  activeHref,
  activeKey,
  onSelect,
  emptyText,
  footerText,
  switcherTop,
  switcherKind,
  fromSuperAdminSearch,
  onNavigate,
  onSignOut,
}: SidebarProps) {
  const navRef = useRef<HTMLElement>(null);

  const isActive = (item: SidebarNavItem): boolean => {
    if (item.active !== undefined) return item.active;
    if (!item.to) return !!item.key && activeKey === item.key;
    if (activeHref) return item.to === activeHref;
    return pathname === item.to || !!pathname?.startsWith(item.to + "/");
  };
  const activeLabel = nav.find(isActive)?.label;

  // A long menu opens on the page you are on, not at the top.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [activeLabel]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-3 pt-5">
        <Image
          src={withBase("/brand/row-logo.png")}
          alt="Roster On Wheels"
          width={220}
          height={95}
          className="h-auto w-full max-w-[148px] object-contain"
          priority
        />
      </div>

      <div className="mx-3 mb-1 flex items-center gap-2.5 px-2 py-2">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-azure text-xs font-bold text-white" aria-hidden="true">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{identityName}</p>
          <p className="truncate text-xs text-muted-foreground">{identityRole}</p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 border-y border-[color:var(--row-line)] px-3">
        <nav ref={navRef} aria-label={brand} className="relative flex flex-col gap-0.5 py-3">
          <Glide className="rounded-md bg-azure" />
          {nav.length === 0 && emptyText && <p className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</p>}
          {nav.map((item, i) => {
            const active = isActive(item);
            const Icon = item.icon;
            const heading = item.group && item.group !== nav[i - 1]?.group ? item.group : null;
            const cls = cn(
              "group relative flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] transition-colors duration-200 lg:min-h-[38px]",
              active ? "font-semibold text-white" : "font-medium text-foreground/80 hover:bg-card/70 hover:text-foreground",
            );
            const inner = (
              <>
                {Icon && <Icon size={18} className={cn("flex-shrink-0 transition-colors duration-200", active ? "text-coral" : "text-muted-foreground group-hover:text-azure")} />}
                <span className="min-w-0 leading-tight">{item.label}</span>
              </>
            );
            return (
              <div key={item.to ?? item.key} className="contents">
                {heading && <p className="px-3 pb-1 pt-4 text-[12px] font-semibold text-muted-foreground">{heading}</p>}
                {item.to ? (
                  <Link href={item.to} onClick={onNavigate} className={cls} aria-current={active ? "page" : undefined}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => { if (item.key) onSelect?.(item.key); onNavigate?.(); }}
                    className={cls}
                    aria-current={active ? "page" : undefined}
                  >
                    {inner}
                  </button>
                )}
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer: optional club switcher + role switcher + sign out */}
      <div className="space-y-2 px-3 py-3">
        {!fromSuperAdminSearch && switcherTop && (
          <div className="mb-1 border-b border-[color:var(--row-line)] pb-3">{switcherTop}</div>
        )}
        {!fromSuperAdminSearch && switcherKind && (
          <DashboardSwitcher currentKind={switcherKind} onNavigate={onNavigate} />
        )}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-[13px] text-foreground/80">
            <LogOut size={16} />
            <span>Sign Out</span>
          </Button>
          <p className="min-w-0 truncate pr-2 text-[12px] text-muted-foreground">{footerText}</p>
        </div>
      </div>
    </div>
  );
}
