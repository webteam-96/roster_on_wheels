"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Check, ChevronUp, Building2, Search } from "lucide-react";
import { resolveDashboardLanding, getDistrictAllClubsForAdmin, type DashboardEntry } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import RotaryLoader from "@/components/RotaryLoader";

// Wave 9C: bump cache key so old-shape (no scope fields) entries don't leak.
const CACHE_KEY = "dashboard_available_v2";
const LEGACY_CACHE_KEY = "dashboard_available";

interface DashboardSwitcherProps {
  currentKind: "ag" | "club-admin" | "district-admin" | "club-moderator" | "zonal-coordinator" | "goal-oversight" | "ri-director" | "super-admin";
  onNavigate?: () => void;
}

function readCache(): DashboardEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(entries: DashboardEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
    // Clear the legacy cache once we've written the v2 cache.
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // Ignore quota errors
  }
}

// Composite key — uniquely identifies an entry across kind + scope. Goal-oversight entries carry no
// scope but differ by their ?as= role in the route, so key them by route to keep them distinct.
function entryKey(e: DashboardEntry): string {
  if (e.kind === "goal-oversight") return `goal-oversight-${e.route}`;
  const scope = e.clubId ?? e.districtId ?? e.zoneId ?? "global";
  return `${e.kind}-${scope}`;
}

// Scope suffix for display — empty string when no scope is attached.
function scopeSuffix(e: DashboardEntry): string {
  if (e.clubName) return e.clubName;
  if (e.districtNumber) return `D${e.districtNumber}`;
  if (e.zoneName) return e.zoneName;
  return "";
}

// Friendly label: "Club Admin — Rotary Club Mumbai West" or just "RI Director".
function friendlyLabel(e: DashboardEntry): string {
  const suffix = scopeSuffix(e);
  if (!suffix) return e.label;
  return `${e.label} — ${suffix}`;
}

// Short scope-only label used inside a grouped role section (the role header
// already says "Club Admin", so the row just shows the scope).
function scopeOnlyLabel(e: DashboardEntry): string {
  return scopeSuffix(e) || e.label;
}

export default function DashboardSwitcher({ currentKind, onNavigate }: DashboardSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();
  const [available, setAvailable] = useState<DashboardEntry[]>(() => readCache() ?? []);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // ── District-Admin "all clubs" section (merged into this one list) ──────────
  // A District Admin with all-clubs access sees their district's clubs appended
  // BELOW the role entries — one dropdown, roles first then clubs. The ONLY gate
  // is "is this member a district admin with club access?" — so the clubs list
  // stays visible in EVERY dashboard they switch into (district-admin, club-admin,
  // AG), never disappearing after they open a club. A DA without club access
  // (or a non-DA) sees no clubs section.
  const daAccess = auth.user?.districtClubAccess ?? [];
  const showClubs = daAccess.length > 0;
  const daDistrictId = showClubs
    ? (daAccess.find((d) => d.id === auth.selectedDistrictId)?.id ?? daAccess[0]?.id ?? null)
    : null;
  const [daClubs, setDaClubs] = useState<Array<{ clubId: number; clubName: string }>>([]);
  const [daQuery, setDaQuery] = useState("");
  const [switching, setSwitching] = useState(false);
  // The district-access club currently open (id + name), remembered by handleSelectClub.
  const [daActiveClub, setDaActiveClub] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("da_active_club");
      setDaActiveClub(raw ? JSON.parse(raw) : null);
    } catch { setDaActiveClub(null); }
  }, []);

  useEffect(() => {
    if (!daDistrictId) { setDaClubs([]); return; }
    let cancelled = false;
    getDistrictAllClubsForAdmin(daDistrictId)
      .then((rows) => { if (!cancelled) setDaClubs(rows); })
      .catch(() => { if (!cancelled) setDaClubs([]); });
    return () => { cancelled = true; };
  }, [daDistrictId]);

  const handleSelectClub = (club: { clubId: number; clubName: string }) => {
    setOpen(false);
    setSwitching(true);
    onNavigate?.();
    // Remember the opened club (id + name). A district-access club isn't in
    // accessibleClubs, so the club-admin header reads its name from here instead
    // of falling back to the DA's own admin club.
    try { localStorage.setItem("da_active_club", JSON.stringify({ id: club.clubId, name: club.clubName })); } catch { /* ignore */ }
    auth.selectScope({ clubId: club.clubId });
    // Hard-navigate — crossing into the club-admin dashboard needs a fresh mount.
    window.location.assign("/club-admin-dashboard");
  };

  // Portal target — only available client-side after mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Track trigger position so the portal-rendered dropdown lines up with the
  // trigger button. Recompute whenever open flips on, plus on resize/scroll.
  useLayoutEffect(() => {
    if (!open) return;
    function compute() {
      const t = triggerRef.current;
      if (!t) return;
      const rect = t.getBoundingClientRect();
      setPortalPos({
        top: rect.top,
        left: rect.left,
        width: rect.width,
      });
    }
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  // ALWAYS re-fetch on mount. The cached value (read by useState above) is
  // only used as a first-paint placeholder so the dropdown doesn't flicker
  // empty for a beat. We don't gate on `available.length > 0` because a stale
  // cache from a prior session (e.g. one that had only the old DA entry before
  // a soft-delete) would otherwise silently hide the switcher forever:
  //   - `available.length === 1 → switcher returns null`
  //   - cache short-circuit `if (length > 0) return` → never re-fetches
  //   - user never sees the dropdown again until they clear localStorage.
  // Refetching on every mount is cheap (single GET) and always self-heals.
  useEffect(() => {
    let cancelled = false;
    resolveDashboardLanding()
      .then((r) => {
        if (cancelled) return;
        const next = r?.available && r.available.length > 0 ? r.available : null;
        // CRITICAL: only update state when backend returned a valid non-empty
        // list. If the backend returns nothing (transient auth issue, slow
        // API, race after logout), DO NOT clear the cached list — that would
        // collapse `available.length` to 0 and make the entire switcher
        // unmount (return null below), which the user perceives as
        // "the dropdown closed by itself the moment I opened it". Keep last
        // known good state; the user can refresh to retry.
        if (next === null) {
          if (typeof window !== "undefined" && (window as unknown as { __DASH_DEBUG__?: boolean }).__DASH_DEBUG__) {
            // eslint-disable-next-line no-console
            console.warn("[DashboardSwitcher] backend returned no entries; keeping cached list");
          }
          return;
        }
        setAvailable((prev) => {
          if (prev.length !== next.length) return next;
          for (let i = 0; i < next.length; i++) {
            const p = prev[i];
            const n = next[i];
            if (
              p.kind !== n.kind ||
              p.route !== n.route ||
              p.label !== n.label ||
              p.clubId !== n.clubId ||
              p.districtId !== n.districtId ||
              p.zoneId !== n.zoneId
            ) return next;
          }
          return prev; // identical content → keep same reference, no re-render
        });
        writeCache(next);
      })
      .catch(() => {
        // Silent — keep cache as fallback paint. Never zero out available
        // here either.
      });
    return () => { cancelled = true; };
  }, []);

  // Close on click-outside. Arm the listener only AFTER a paint frame so the
  // very mousedown/mouseup that opened the dropdown can never close it on the
  // same gesture. `setTimeout(0)` schedules a macrotask but can still resolve
  // before the browser paints — `requestAnimationFrame` is a stronger guard.
  // Use `mousedown` for snappier UX: closes when the user starts pressing
  // outside, not when they release. Internal entries get checked by ref
  // containment (or composedPath fallback) so their own mousedown is ignored.
  useEffect(() => {
    if (!open) return;
    let armed = false;
    const armFrame = window.requestAnimationFrame(() => {
      armed = true;
    });
    function handleClick(e: MouseEvent) {
      if (!armed) return;
      const root = dropdownRef.current;
      const trigger = triggerRef.current;
      const portal = portalRef.current;
      const target = e.target as Node | null;
      if (!target) return;
      // Inside the .relative wrapper (legacy) → ignore.
      if (root && root.contains(target)) return;
      // Inside the trigger button → ignore (it has its own toggle).
      if (trigger && trigger.contains(target)) return;
      // Inside the portaled dropdown body → ignore.
      if (portal && portal.contains(target)) return;
      const path = (e.composedPath?.() ?? []) as Node[];
      if (root && path.includes(root)) return;
      if (trigger && path.includes(trigger)) return;
      if (portal && path.includes(portal)) return;
      if (typeof window !== "undefined" && (window as unknown as { __DASH_DEBUG__?: boolean }).__DASH_DEBUG__) {
        // eslint-disable-next-line no-console
        console.log("[DashboardSwitcher] outside-click close", { target });
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => {
      window.cancelAnimationFrame(armFrame);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  // Identify the currently-active entry: match kind + selected scope.
  const currentAs = searchParams.get("as");
  const currentEntry = useMemo<DashboardEntry | undefined>(() => {
    const sameKind = available.filter((e) => e.kind === currentKind);
    if (sameKind.length === 0) return undefined;
    // Goal-oversight: several entries (RI Director / ZC / DA) share the kind but differ by ?as= —
    // tick the one matching the current URL's role.
    if (currentKind === "goal-oversight") {
      return sameKind.find((e) => e.route.includes(`as=${currentAs}`)) ?? sameKind[0];
    }
    if (sameKind.length === 1) return sameKind[0];
    // Multi-scope of same kind: prefer the entry whose scope matches AuthContext.
    const matchScoped = sameKind.find(
      (e) =>
        (e.clubId != null && e.clubId === auth.selectedClubId) ||
        (e.districtId != null && e.districtId === auth.selectedDistrictId) ||
        (e.zoneId != null && e.zoneId === auth.selectedZoneId),
    );
    return matchScoped ?? sameKind[0];
  }, [available, currentKind, currentAs, auth.selectedClubId, auth.selectedDistrictId, auth.selectedZoneId]);

  // Group entries by kind so multi-scope kinds render under a single header.
  // Preserve first-seen order of kinds.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { label: string; entries: DashboardEntry[] }>();
    for (const e of available) {
      const bucket = map.get(e.kind);
      if (bucket) {
        bucket.entries.push(e);
      } else {
        map.set(e.kind, { label: e.label, entries: [e] });
        order.push(e.kind);
      }
    }
    return order.map((k) => {
      const b = map.get(k)!;
      return { kind: k, roleLabel: b.label, entries: b.entries };
    });
  }, [available]);

  // Hide only when there's nothing to switch to — but a flagged DA always has a
  // clubs section to show even with a single role, so keep it in that case.
  if (available.length <= 1 && !showClubs) return null;

  const currentKey = currentEntry ? entryKey(currentEntry) : null;

  // When a DA is viewing a district-access club, currentEntry resolves to their
  // OWN club-admin entry (wrong club). Show the actually-open club in the trigger.
  const viewingDaClub =
    currentKind === "club-admin" &&
    !!daActiveClub &&
    daActiveClub.id === auth.selectedClubId &&
    currentEntry?.clubId !== auth.selectedClubId;
  // District-access club → NOT a club admin, so show just the club name (no
  // "Club Admin —" prefix). A real club-admin entry keeps its labelled form.
  const triggerLabel = viewingDaClub
    ? daActiveClub!.name
    : (currentEntry ? friendlyLabel(currentEntry) : "Switch dashboard");

  const handleSelect = (entry: DashboardEntry) => {
    setOpen(false);
    // Same kind AND same scope → no-op (just close).
    if (currentKey && entryKey(entry) === currentKey) return;

    // Apply scope selection (if the entry carries any). selectScope writes
    // the new clubId/districtId/zoneId into AuthContext + localStorage so the
    // next page mount reads the right scope.
    const scopeArgs: { clubId?: number | null; districtId?: number | null; zoneId?: number | null } = {};
    if (entry.clubId != null) scopeArgs.clubId = entry.clubId;
    if (entry.districtId != null) scopeArgs.districtId = entry.districtId;
    if (entry.zoneId != null) scopeArgs.zoneId = entry.zoneId;
    if (Object.keys(scopeArgs).length > 0) {
      auth.selectScope(scopeArgs);
    }

    onNavigate?.();

    // Hard navigation (full page load) when switching between dashboard kinds.
    // router.push() does soft navigation which reuses the current React tree —
    // that can leave stale layout state, cached data providers, and previous
    // sidebar items briefly visible while the new dashboard's data fetches in
    // the background. A hard navigation guarantees a fresh mount of the
    // destination dashboard's layout + cache provider + data fetches.
    // For same-kind switches (just a scope change), soft navigation is fine
    // because the layout doesn't change.
    if (entry.kind !== currentKind) {
      window.location.assign(entry.route);
    } else {
      router.push(entry.route);
    }
  };

  // Clubs the user is ALREADY a club admin of appear as role entries above — so
  // exclude them from the "Open a Club" list to avoid showing the same club twice.
  const roleClubIds = new Set(
    available.filter((e) => e.kind === "club-admin" && e.clubId != null).map((e) => e.clubId as number),
  );
  const daClubsBase = daClubs.filter((c) => !roleClubIds.has(c.clubId));

  // Club list (capped) for the DA clubs section — safe for 200+ clubs.
  const daClubsFiltered = daQuery.trim()
    ? daClubsBase.filter((c) => c.clubName.toLowerCase().includes(daQuery.trim().toLowerCase()))
    : daClubsBase;
  const DA_CAP = 60;
  const daClubsVisible = daClubsFiltered.slice(0, DA_CAP);
  const daHidden = daClubsFiltered.length - daClubsVisible.length;

  // Dropdown body — rendered once, used by both inline (no-portal fallback) and
  // portal paths. Carries `portalRef` so the outside-click handler can check
  // containment regardless of where it landed in the DOM.
  const dropdownBody = (
    <div
      ref={portalRef}
      onMouseDown={(e) => e.stopPropagation()}
      className="rounded-lg shadow-2xl overflow-hidden border border-white/10"
      style={{ backgroundColor: "#1e293b" }}
    >
      <p className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-white/10">
        Switch dashboard
      </p>
      <ul className="py-1 max-h-80 overflow-y-auto">
        {grouped.map((group) => {
          const isMultiScope = group.entries.length > 1;
          return (
            <li key={group.kind}>
              {isMultiScope && (
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {group.roleLabel}
                </p>
              )}
              <ul>
                {group.entries.map((entry) => {
                  const key = entryKey(entry);
                  const isCurrent = key === currentKey;
                  const display = isMultiScope ? scopeOnlyLabel(entry) : friendlyLabel(entry);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(entry);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors ${
                          isMultiScope ? "pl-6" : ""
                        } ${
                          isCurrent
                            ? "text-amber-300 bg-white/5 cursor-default"
                            : "text-slate-200 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        <span className="truncate">{display}</span>
                        {isCurrent && <Check size={12} className="text-amber-300 flex-shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {/* Clubs section — Roles first (above), then all clubs. DA-with-access only. */}
      {showClubs && (
        <div className="border-t border-white/10">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Building2 size={11} /> Open a Club
          </p>
          <div className="flex items-center gap-1.5 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              value={daQuery}
              onChange={(e) => setDaQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Search clubs…"
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {daClubsFiltered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">
                {daClubs.length ? "No clubs found." : "Loading clubs…"}
              </li>
            ) : (
              <>
                {daClubsVisible.map((c) => (
                  <li key={c.clubId}>
                    <button
                      type="button"
                      title={c.clubName}
                      onClick={(e) => { e.stopPropagation(); handleSelectClub(c); }}
                      className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:text-white hover:bg-white/10 truncate transition-colors"
                    >
                      {c.clubName}
                    </button>
                  </li>
                ))}
                {daHidden > 0 && (
                  <li className="px-3 py-1.5 text-[10px] text-slate-500">
                    +{daHidden} more — type to narrow
                  </li>
                )}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {switching && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-sm">
          <RotaryLoader size="lg" />
          <p className="text-sm font-medium text-slate-200">Opening club dashboard…</p>
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all border border-white/10"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ArrowLeftRight size={13} className="flex-shrink-0" />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronUp size={12} className={`flex-shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && mounted && portalPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: portalPos.left,
              top: portalPos.top - 8, // 8px gap above trigger; transform shifts to "above"
              width: portalPos.width,
              transform: "translateY(-100%)",
              zIndex: 9999,
            }}
          >
            {dropdownBody}
          </div>,
          document.body,
        )}
    </div>
  );
}
