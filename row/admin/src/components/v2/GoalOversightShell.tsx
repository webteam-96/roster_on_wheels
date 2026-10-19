"use client";

/**
 * GoalOversightShell — V2 sidebar + topbar chrome for the Goal Setting oversight roles
 * (RI Director / Zone Co-ordinator / District Assistant). Visually mirrors DistrictAdminShell
 * (dark sidebar, amber active pill, identity card, sign-out) but carries no district/club
 * machinery — the nav items are passed in by the page (its goal categories), and the goal
 * content renders inside. Auth is handled by the page's own ProtectedRoute.
 */

import { ReactNode, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, LogOut, Target } from "@/components/icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import DashboardSwitcher from "@/components/dashboard/DashboardSwitcher";
import { cn } from "@/lib/utils";

const SIDEBAR_BG = "#FCFDFE";
const ACTIVE_BG = "#17458F";
const ACTIVE_TEXT = "#FCFDFE";

export interface GoalOversightNavItem {
  label: string;
  href: string;
  active?: boolean;
}

function getInitials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export default function GoalOversightShell({
  pageTitle,
  pageSubtitle,
  roleLabel,
  nav,
  children,
  headerRight,
}: {
  pageTitle: string;
  pageSubtitle?: string;
  roleLabel?: string;                 // e.g. "RI Director" / "Zone Co-ordinator"
  nav: GoalOversightNavItem[];
  children: ReactNode;
  headerRight?: ReactNode;            // top-right header slot (e.g. the global Year picker)
}) {
  const [open, setOpen] = useState(false);
  const { logout, user } = useAuth();
  const identityName = user?.name ?? "Goal Setting";
  const initials = getInitials(identityName) || "GS";
  // Brand caption: "Goal Overview" for Super Admin, "Goal Setting" for RI Director / ZC / DA.
  const brand = roleLabel === "Super Admin" ? "Goal Overview" : "Goal Setting";

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[color:var(--row-line)]">
        <Image
          src="/brand/row-logo.png"
          alt="Roster On Wheels"
          width={220}
          height={95}
          className="w-full max-w-[188px] h-auto object-contain"
          priority
        />
        <p className="text-xs text-muted-foreground mt-2 font-medium">{brand}</p>
      </div>

      {/* Identity card */}
      <div className="px-3 py-3 border-b border-[color:var(--row-line)]">
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ backgroundColor: "rgba(27,44,66,0.05)" }}>
          <Avatar className="h-9 w-9 rounded-md flex-shrink-0">
            <AvatarFallback className="text-xs font-bold rounded-md" style={{ background: ACTIVE_BG, color: ACTIVE_TEXT }}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-foreground text-sm font-semibold truncate">{identityName}</p>
            <p className="text-muted-foreground text-xs truncate">{roleLabel || brand}</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 px-1 tracking-wide uppercase">Signed in</p>
      </div>

      {/* Nav — the categories this member oversees */}
      <ScrollArea className="flex-1 px-2 py-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 pb-2">Categories</p>
        <nav className="flex flex-col gap-0.5">
          {nav.length === 0 && (
            <p className="text-muted-foreground text-xs px-3 py-2">No categories in your scope.</p>
          )}
          {nav.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 mx-0.5 my-0.5 rounded-lg text-sm font-medium transition-all duration-150",
                item.active ? "font-semibold shadow-sm" : "text-foreground/70 hover:text-foreground hover:bg-muted"
              )}
              style={item.active ? { backgroundColor: ACTIVE_BG, color: ACTIVE_TEXT } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.active ? ACTIVE_TEXT : "#5E93D6" }} />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
      </ScrollArea>

      <Separator className="bg-[color:var(--row-line)] mx-3" />

      <div className="px-3 py-3 space-y-2">
        {/* Switch to another dashboard the member holds (District/Club Admin, Super Admin, …). */}
        <DashboardSwitcher currentKind="goal-oversight" onNavigate={() => setOpen(false)} />
        <button
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-foreground/70 hover:text-foreground hover:bg-muted transition-all"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
        <p className="text-muted-foreground text-[11px] text-center tracking-widest uppercase">Rotary {brand}</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex h-screen overflow-hidden bg-slate-50" style={{ top: 0, left: 0 }}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 border-r border-[color:var(--row-line)]" style={{ background: SIDEBAR_BG }}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative flex flex-col w-60 z-10 shadow-2xl" style={{ background: SIDEBAR_BG }}>
            <button className="absolute top-3 right-3 text-slate-400 hover:text-foreground" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b-2 px-6 h-14 flex items-center justify-between flex-shrink-0 gap-3" style={{ borderBottomColor: ACTIVE_BG }}>
          <div className="flex items-center gap-3 min-w-0">
            <button className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setOpen(true)}>
              <Menu size={20} />
            </button>
            <Target size={18} className="text-blue-600 hidden sm:block" />
            <div className="min-w-0">
              <p className="text-slate-800 font-semibold text-base leading-tight truncate">{pageTitle}</p>
              {pageSubtitle && <p className="text-slate-400 text-xs mt-0.5 truncate">{pageSubtitle}</p>}
            </div>
          </div>
          {headerRight && <div className="flex items-center gap-2 flex-shrink-0">{headerRight}</div>}
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
