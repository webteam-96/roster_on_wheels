"use client";

import { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { LogOut, type LucideIcon } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import DashboardSwitcher from "./DashboardSwitcher";

// ROW "Fellowship": a light rail; azure (Rotary Royal Blue) marks the selected item.
// Single shared sidebar for every dashboard shell (District / Club / AG / RI-Director).
const ACTIVE_BG = "#17458F";
const ACTIVE_TEXT = "#FCFDFE";

export interface SidebarNavItem {
  label: string;
  icon?: LucideIcon;
  /** Route-link item (active by pathname). */
  to?: string;
  /** View-switch item (active by `activeKey`, fires `onSelect`). */
  key?: string;
}

export interface SidebarProps {
  brand: string;
  identityName: string;
  identityRole: string;
  identityLabel: string;
  initials: string;
  nav: SidebarNavItem[];
  pathname?: string | null;
  /** For view-switch navs: the selected key and the handler. */
  activeKey?: string;
  onSelect?: (key: string) => void;
  variant?: "icon" | "dot";
  footerText: ReactNode;
  switcherTop?: ReactNode;
  switcherKind?: "ag" | "club-admin" | "district-admin" | "goal-oversight" | "super-admin";
  fromSuperAdminSearch?: boolean;
  onNavigate?: () => void;
  onSignOut: () => void;
}

export default function Sidebar({
  brand,
  identityName,
  identityRole,
  identityLabel,
  initials,
  nav,
  pathname,
  activeKey,
  onSelect,
  variant = "dot",
  footerText,
  switcherTop,
  switcherKind,
  fromSuperAdminSearch,
  onNavigate,
  onSignOut,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4 border-b border-[color:var(--row-line)]">
        <Image
          src="/brand/row-logo.png"
          alt="Roster On Wheels"
          width={220}
          height={95}
          className="w-full max-w-[188px] h-auto object-contain"
          priority
        />
        <p className="text-xs text-muted-foreground mt-3 font-medium truncate">{brand}</p>
      </div>

      {/* Identity */}
      <div className="px-3 py-3 border-b border-[color:var(--row-line)]">
        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ backgroundColor: "rgba(27,44,66,0.05)" }}>
          <Avatar className="h-9 w-9 rounded-xl flex-shrink-0">
            <AvatarFallback className="text-xs font-bold rounded-xl" style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-foreground text-sm font-semibold truncate">{identityName}</p>
            <p className="text-muted-foreground text-xs truncate">{identityRole}</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 px-1 tracking-wide uppercase truncate">{identityLabel}</p>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 pb-2">Navigation</p>
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const isActive = item.to
              ? pathname === item.to || !!pathname?.startsWith(item.to + "/")
              : !!item.key && activeKey === item.key;
            const Icon = item.icon;
            const cls = cn(
              "flex items-center gap-2.5 px-3 py-2.5 mx-0.5 my-0.5 rounded-xl text-sm font-medium text-left transition-all duration-150 w-full",
              isActive ? "font-semibold shadow-sm" : "text-foreground/70 hover:text-foreground hover:bg-muted",
            );
            const style = isActive ? { backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT } : undefined;
            const inner = (
              <>
                {variant === "icon" && Icon ? (
                  <Icon size={17} className="flex-shrink-0" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? ACTIVE_TEXT : "#5E93D6" }} />
                )}
                <span className="min-w-0 leading-tight">{item.label}</span>
              </>
            );
            return item.to ? (
              <Link key={item.to} href={item.to} onClick={onNavigate} className={cls} style={style}>
                {inner}
              </Link>
            ) : (
              <button
                key={item.key}
                onClick={() => { if (item.key) onSelect?.(item.key); onNavigate?.(); }}
                className={cls}
                style={style}
              >
                {inner}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-[color:var(--row-line)] mx-3" />

      {/* Footer: optional club switcher + role switcher + sign out */}
      <div className="px-3 py-3 space-y-2">
        {!fromSuperAdminSearch && switcherTop && (
          <div className="pb-3 mb-1 border-b border-[color:var(--row-line)]">{switcherTop}</div>
        )}
        {!fromSuperAdminSearch && switcherKind && (
          <DashboardSwitcher currentKind={switcherKind} onNavigate={onNavigate} />
        )}
        <button
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-full text-xs font-semibold text-foreground/70 hover:text-foreground hover:bg-muted transition-all"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
        <p className="text-muted-foreground text-[11px] text-center tracking-widest uppercase truncate">{footerText}</p>
      </div>
    </div>
  );
}
