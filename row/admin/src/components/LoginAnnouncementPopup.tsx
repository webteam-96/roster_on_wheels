"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getActiveLoginAnnouncement, acknowledgeLoginAnnouncements } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "@/components/icons";
import { ALL_ROLES_KEY, currentRoleFromPath, loginAnnouncementRoleLabel } from "@/utils/loginAnnouncementRoles";

interface AnnouncementItem {
  id: number;
  content: string;
  roles: string[];
}

export default function LoginAnnouncementPopup() {
  const { user } = useAuth();
  const pathname = usePathname();
  // Every active, un-acknowledged announcement for ANY of the user's roles — browsed with ◀ ▶.
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [index, setIndex] = useState(0);
  // Which member we've already checked/shown the announcement for THIS login. The
  // popup component stays mounted across client-side navigation, so this ref survives
  // page changes and stops the popup re-appearing on every page. It resets on logout,
  // so a fresh login shows it again (unless the user clicked OK → server-side "read").
  const shownForRef = useRef<number | null>(null);

  useEffect(() => {
    // Logged out → reset so the next login re-checks and shows again.
    if (!user) { shownForRef.current = null; setItems([]); return; }
    // POST-LOGIN popup only — never show it on the public marketing home ("/") or any
    // other public / pre-login page, even when a logged-in token happens to persist.
    // ("/login" also hosts the temp-password dialog; two modals there are unclickable.)
    const isPublicPage =
      pathname === "/" ||
      pathname.startsWith("/login") ||
      pathname.startsWith("/public") ||
      pathname.startsWith("/forgot-password") ||
      pathname.startsWith("/reset-password") ||
      pathname.startsWith("/privacy-policy") ||
      pathname.startsWith("/cookies") ||
      pathname.startsWith("/refunds-and-cancellations") ||
      pathname.startsWith("/pay");
    if (isPublicPage) return;
    // Show ONCE per login, not on every navigation. Only fetch when this login
    // hasn't been checked yet; plain page changes (same member) are ignored.
    if (shownForRef.current === user.memberId) return;
    shownForRef.current = user.memberId;
    (async () => {
      try {
        // The first post-login page is the landing dashboard — its role's announcements come first.
        const result = await getActiveLoginAnnouncement(currentRoleFromPath(pathname));
        const list: AnnouncementItem[] = Array.isArray(result?.items) && result.items.length > 0
          ? result.items
          : result?.show ? [{ id: result.id, content: result.content, roles: [] }] : [];
        if (list.length > 0) {
          setIndex(0);
          setItems(list);
        }
      } catch {
        // silent — don't block login
      }
    })();
  }, [user, pathname]);

  if (items.length === 0) return null;

  const total = items.length;
  const safeIndex = Math.min(index, total - 1);
  const current = items[safeIndex];
  const roleText = (current.roles || [])
    .filter((r) => r !== ALL_ROLES_KEY)
    .map(loginAnnouncementRoleLabel)
    .join(", ");

  const handleClose = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setItems([]);
    // X button: just close, will show again next login
  };

  const handleOk = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    // Close popup IMMEDIATELY so UX is snappy; ack fires in background.
    // Even if ack fails (e.g. 401 auth edge-case), the modal still closes and
    // won't trigger a login-page redirect / Chrome autofill dropdown.
    // OK marks EVERY announcement in this popup as read (not only the one on screen).
    const ids = items.map((i) => i.id);
    setItems([]);
    try {
      await acknowledgeLoginAnnouncements(ids);
    } catch {
      // silent — popup is already closed; worst case it shows again next login
    }
  };

  const go = (delta: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
  };

  // Wrapped in a <form autoComplete="off"> so Chrome never treats any button-click
  // as "submit a login form" → no password-manager autofill dropdown.
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        autoComplete="off"
        onSubmit={(e) => e.preventDefault()}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b bg-primary/10">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-primary">Announcement</h3>
            {(roleText || total > 1) && (
              <p className="text-xs text-muted-foreground truncate">
                {roleText && <>For: {roleText}</>}
                {roleText && total > 1 && " · "}
                {total > 1 && `${safeIndex + 1} of ${total}`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex items-center justify-center w-8 h-8 shrink-0 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
            title="Close (will show again next login)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div
            key={current.id}
            className="prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto"
            dangerouslySetInnerHTML={{ __html: current.content }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t bg-gray-50">
          {total > 1 ? (
            <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={go(-1)} disabled={safeIndex === 0} title="Previous announcement">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : <span className="w-10" />}
          <Button
            type="button"
            onClick={handleOk}
            size="lg"
            className="px-10 rounded-full shadow-md"
          >
            OK
          </Button>
          {total > 1 ? (
            <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={go(1)} disabled={safeIndex === total - 1} title="Next announcement">
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : <span className="w-10" />}
        </div>
      </form>
    </div>
  );
}
