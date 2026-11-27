"use client";

import { IconButton } from "@/components/ui/icon-button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getCreditNotifications } from "@/services/api";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, Clock, Key, LogOut, ShieldCheck, User } from "@/components/icons";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import LanguagePicker from "@/components/LanguagePicker";
import HelpLink from "@/components/HelpLink";
import HeaderAdminDashboardLink from "@/components/HeaderAdminDashboardLink";
import SuperAdminBackToSearch from "@/components/SuperAdminBackToSearch";
import { appLocale } from "@/lib/appFormat";

function formatTime(totalSeconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(totalSeconds / 3600)}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}

interface CreditNotification {
  creditType: string;
  remainingCredits: number;
  expiryDate: string;
  daysLeft: number;
}

const SESSION_WARNING_S = 300;

/** Help, language, notices and the account menu: the right end of every top bar. `backLinks` are for the pages outside
 *  the role dashboards, which have no other way back to them. */
export default function TopBarAccount({ backLinks = false }: { backLinks?: boolean }) {
  const { user, isAuthenticated, isAdmin, lastLoginTime, sessionRemaining, logout } = useAuth();
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [notifications, setNotifications] = useState<CreditNotification[]>([]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    getCreditNotifications().then((d) => setNotifications(d || [])).catch(() => {});
  }, [isAuthenticated, isAdmin]);

  if (!isAuthenticated) return null;
  const sessionLow = sessionRemaining > 0 && sessionRemaining < SESSION_WARNING_S;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {backLinks && <HeaderAdminDashboardLink />}
      {backLinks && <SuperAdminBackToSearch />}
      {sessionLow && (
        <span role="status" className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white">
          <Clock size={14} />
          <span className="tabular-nums">{formatTime(sessionRemaining)}</span>
        </span>
      )}
      <HelpLink />
      <LanguagePicker signedIn className="hidden min-w-0 border-transparent bg-transparent lg:flex" />
      {isAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton type="button" className="relative" aria-label={`Notifications (${notifications.length})`}>
              <Bell size={18} />
              {notifications.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-marigold text-[10px] font-bold text-ink">
                  {notifications.length}
                </span>
              )}
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="z-[70] w-80 p-0">
            <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              <ul className="max-h-60 overflow-y-auto">
                {notifications.map((n, i) => (
                  <li key={i} className="border-b px-4 py-3 text-sm last:border-0">
                    {n.creditType} credits expire on {new Date(n.expiryDate).toLocaleDateString(appLocale())} ({n.daysLeft} day{n.daysLeft !== 1 ? "s" : ""} left).{" "}
                    {n.remainingCredits} credit{n.remainingCredits !== 1 ? "s" : ""} remaining.
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton type="button"  aria-label="Account menu" title={user?.name}>
            <User size={18} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[70] w-60">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-semibold">{user?.name || "User"}</p>
            {lastLoginTime && (
              <p className="text-xs text-muted-foreground">
                Last login: {new Date(lastLoginTime).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            {sessionRemaining > 0 && <p className="text-xs tabular-nums text-muted-foreground">Session ends in {formatTime(sessionRemaining)}</p>}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsPasswordOpen(true)}><Key className="mr-2 h-4 w-4" />Change Password</DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/account/security"><ShieldCheck className="mr-2 h-4 w-4" />Account security</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}><LogOut className="mr-2 h-4 w-4" />Logout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={isPasswordOpen} onClose={() => setIsPasswordOpen(false)} />
    </div>
  );
}
