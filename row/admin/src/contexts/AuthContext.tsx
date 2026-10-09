"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, ReactNode } from "react";
import { AuthUser } from "@/types/auth";
import type {
  RoleScopeDto,
  ZoneScopeDto,
  DistrictScopeDto,
  ClubScopeDto,
} from "@/types/scope";

interface SelectScopeArgs {
  clubId?: number | null;
  districtId?: number | null;
  zoneId?: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isZonalCoordinator: boolean;
  isRIDirector: boolean;
  isAG: boolean;
  isClubModerator: boolean;
  loading: boolean;
  lastLoginTime: string | null;
  sessionRemaining: number; // seconds remaining
  // Wave 9B: selected scope (persisted, restored on mount)
  selectedClubId: number | null;
  selectedDistrictId: number | null;
  selectedZoneId: number | null;
  selectScope: (scope: SelectScopeArgs) => void;
  login: (token: string, user: AuthUser, lastLoginTime?: string | null, sessionExpiryMinutes?: number) => void;
  logout: () => void;
  resetSessionTimer: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isAuthenticated: false,
  isSuperAdmin: false,
  isAdmin: false,
  isZonalCoordinator: false,
  isRIDirector: false,
  isAG: false,
  isClubModerator: false,
  loading: true,
  lastLoginTime: null,
  sessionRemaining: 0,
  selectedClubId: null,
  selectedDistrictId: null,
  selectedZoneId: null,
  selectScope: () => {},
  login: () => {},
  logout: () => {},
  resetSessionTimer: () => {},
});

// Exported so UI that must know the TRUE login identity (e.g. the SuperAdmin "Back to Search"
// shortcut) can read roles straight from the JWT — `user.roles` is scoped/stripped by my-context
// when a SuperAdmin drills into a District/Club/Zone dashboard.
export function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return {
      memberId: parseInt(payload.memberId),
      name: payload.name,
      email: payload.email,
      roles: payload.roles ? payload.roles.split(",") : [],
    };
  } catch {
    return null;
  }
}

const SESSION_EXPIRY_KEY = "session_expiry";
const SESSION_DURATION_KEY = "session_duration_ms";
const LAST_LOGIN_KEY = "last_login_time";
const DEFAULT_SESSION_MINUTES = 480;

// Wave 9B: localStorage keys for scope data + selected scope (namespaced under auth_*)
const AUTH_SCOPE_DATA_KEY = "auth_scope_data";
const SELECTED_CLUB_ID_KEY = "auth_selectedClubId";
const SELECTED_DISTRICT_ID_KEY = "auth_selectedDistrictId";
const SELECTED_ZONE_ID_KEY = "auth_selectedZoneId";

// A "borrowed" scope is a club/district the user can open but does NOT hold a role in:
// SuperAdmin via global search, or a District Admin with all-clubs access. It is by
// definition absent from accessibleClubs/accessibleDistricts, so the selected-scope
// hooks below would fall back to the user's OWN club/district and mislabel the page.
// The opener records {id, name} here before hard-navigating into the dashboard.
const ACTIVE_CLUB_KEY = "da_active_club";
const ACTIVE_DISTRICT_KEY = "sa_active_district";

function readBorrowedScope(key: string): { id: number; name: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
    if (typeof parsed?.id !== "number" || typeof parsed?.name !== "string" || !parsed.name) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

interface PersistedScopeData {
  scopedRoles?: RoleScopeDto[];
  accessibleZones?: ZoneScopeDto[];
  accessibleDistricts?: DistrictScopeDto[];
  accessibleClubs?: ClubScopeDto[];
  districtClubAccess?: DistrictScopeDto[];
}

function readPersistedScopeData(): PersistedScopeData | null {
  try {
    const raw = localStorage.getItem(AUTH_SCOPE_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedScopeData;
  } catch {
    return null;
  }
}

function writePersistedScopeData(data: PersistedScopeData) {
  try {
    localStorage.setItem(AUTH_SCOPE_DATA_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be full / disabled — ignore silently
  }
}

function readNumericLs(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function writeNumericLs(key: string, value: number | null) {
  if (value === null || value === undefined) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, String(value));
  }
}

// Given the user's accessible-scope arrays, pick a sensible default for a kind.
// - If exactly one entry exists → return that id
// - If multiple → return null (let the user choose; selectors fall back to first)
function defaultIdFromList<T extends { id: number }>(list: T[] | undefined): number | null {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0].id;
  return null;
}

// If the previously-selected id is no longer accessible, fall back to:
//   (a) first entry if any are accessible
//   (b) null otherwise
function reconcileSelected<T extends { id: number }>(
  previous: number | null,
  list: T[] | undefined,
): number | null {
  if (!list || list.length === 0) return null;
  if (previous !== null && list.some((x) => x.id === previous)) return previous;
  return list[0].id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoginTime, setLastLoginTime] = useState<string | null>(null);
  const [sessionRemaining, setSessionRemaining] = useState(0);
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [selectedDistrictId, setSelectedDistrictId] = useState<number | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logoutCalledRef = useRef(false);

  const doLogout = useCallback(() => {
    if (logoutCalledRef.current) return;
    logoutCalledRef.current = true;
    localStorage.removeItem("auth_token");
    localStorage.removeItem(SESSION_EXPIRY_KEY);
    localStorage.removeItem(SESSION_DURATION_KEY);
    localStorage.removeItem(LAST_LOGIN_KEY);
    localStorage.removeItem("dashboard_available");
    // Wave 9B: clear scope-related storage on logout
    localStorage.removeItem(AUTH_SCOPE_DATA_KEY);
    localStorage.removeItem(SELECTED_CLUB_ID_KEY);
    localStorage.removeItem(SELECTED_DISTRICT_ID_KEY);
    localStorage.removeItem(SELECTED_ZONE_ID_KEY);
    setToken(null);
    setUser(null);
    setSessionRemaining(0);
    setSelectedClubId(null);
    setSelectedDistrictId(null);
    setSelectedZoneId(null);
    if (timerRef.current) clearInterval(timerRef.current);
    window.location.href = "/login";
  }, []);

  const resetSessionTimer = useCallback(() => {
    const durationMs = parseInt(localStorage.getItem(SESSION_DURATION_KEY) || String(DEFAULT_SESSION_MINUTES * 60000));
    const newExpiry = Date.now() + durationMs;
    localStorage.setItem(SESSION_EXPIRY_KEY, String(newExpiry));
  }, []);

  // Start countdown timer
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const expiry = parseInt(localStorage.getItem(SESSION_EXPIRY_KEY) || "0");
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setSessionRemaining(remaining);
      if (remaining <= 0) {
        doLogout();
      }
    }, 1000);
  }, [doLogout]);

  // Refresh scope data from /api/auth/my-context (called on mount when a token exists)
  // Uses dynamic import to avoid circular dep with services/api.ts (which imports auth types).
  const refreshScopeFromMyContext = useCallback(async () => {
    try {
      const { getMyContext } = await import("@/services/api");
      const data = await getMyContext();
      if (!data) return;

      // /api/auth/my-context uses `roles` (not `scopedRoles`) — normalize into AuthUser shape.
      const scopedRoles: RoleScopeDto[] | undefined = Array.isArray(data.roles)
        ? data.roles
        : Array.isArray(data.scopedRoles)
        ? data.scopedRoles
        : undefined;

      const accessibleZones = Array.isArray(data.accessibleZones) ? data.accessibleZones : undefined;
      const accessibleDistricts = Array.isArray(data.accessibleDistricts) ? data.accessibleDistricts : undefined;
      const accessibleClubs = Array.isArray(data.accessibleClubs) ? data.accessibleClubs : undefined;
      const districtClubAccess = Array.isArray(data.districtClubAccess) ? data.districtClubAccess : undefined;

      writePersistedScopeData({ scopedRoles, accessibleZones, accessibleDistricts, accessibleClubs, districtClubAccess });

      setUser((prev) => {
        if (!prev) return prev;
        return { ...prev, scopedRoles, accessibleZones, accessibleDistricts, accessibleClubs, districtClubAccess };
      });

      // Reconcile selected scope against fresh access lists.
      // Exceptions — these can open a club that is NOT in accessibleClubs, so we must
      // NEVER reconcile their club selection (it would snap back to accessibleClubs[0]):
      //   • SuperAdmin — can open ANY club (e.g. from /settings/global-search).
      //   • District Admin with all-clubs access — any club in their district.
      // my-context strips the SuperAdmin role, so read it from the JWT instead.
      const storedTokenForScope =
        typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const isSuperAdminScope = storedTokenForScope
        ? (decodeJwt(storedTokenForScope)?.roles ?? []).includes("SuperAdmin")
        : false;
      setSelectedClubId((prev) => {
        const hasDistrictClubAccess = (districtClubAccess ?? []).length > 0;
        const keepClub = isSuperAdminScope || hasDistrictClubAccess;
        const next = keepClub ? prev : reconcileSelected(prev, accessibleClubs);
        writeNumericLs(SELECTED_CLUB_ID_KEY, next);
        return next;
      });
      // Same exception as clubs: a SuperAdmin can open ANY district (global search →
      // "New Dashboard"), and that district isn't in their accessibleDistricts — so never
      // reconcile their district selection away.
      setSelectedDistrictId((prev) => {
        const next = isSuperAdminScope ? prev : reconcileSelected(prev, accessibleDistricts);
        writeNumericLs(SELECTED_DISTRICT_ID_KEY, next);
        return next;
      });
      setSelectedZoneId((prev) => {
        const next = reconcileSelected(prev, accessibleZones);
        writeNumericLs(SELECTED_ZONE_ID_KEY, next);
        return next;
      });
    } catch {
      // Network/perm errors — keep cached scope as-is
    }
  }, []);

  // Initialize from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    if (storedToken) {
      const decoded = decodeJwt(storedToken);
      if (decoded) {
        // Check if session expired
        const expiry = parseInt(localStorage.getItem(SESSION_EXPIRY_KEY) || "0");
        if (expiry > 0 && Date.now() > expiry) {
          localStorage.removeItem("auth_token");
          localStorage.removeItem(SESSION_EXPIRY_KEY);
          localStorage.removeItem(SESSION_DURATION_KEY);
          localStorage.removeItem(LAST_LOGIN_KEY);
          localStorage.removeItem(AUTH_SCOPE_DATA_KEY);
          localStorage.removeItem(SELECTED_CLUB_ID_KEY);
          localStorage.removeItem(SELECTED_DISTRICT_ID_KEY);
          localStorage.removeItem(SELECTED_ZONE_ID_KEY);
        } else {
          // Rehydrate persisted scope data (if any)
          const cachedScope = readPersistedScopeData();
          const hydratedUser: AuthUser = cachedScope
            ? { ...decoded, ...cachedScope }
            : decoded;

          setToken(storedToken);
          setUser(hydratedUser);
          setLastLoginTime(localStorage.getItem(LAST_LOGIN_KEY));

          // Restore selected scope from localStorage
          setSelectedClubId(readNumericLs(SELECTED_CLUB_ID_KEY));
          setSelectedDistrictId(readNumericLs(SELECTED_DISTRICT_ID_KEY));
          setSelectedZoneId(readNumericLs(SELECTED_ZONE_ID_KEY));

          logoutCalledRef.current = false;
          startTimer();

          // Refresh scope on every page load (assignments can change)
          // Fire-and-forget — handles reconciliation internally
          void refreshScopeFromMyContext();
        }
      } else {
        localStorage.removeItem("auth_token");
      }
    }
    setLoading(false);
  }, [startTimer, refreshScopeFromMyContext]);

  // Listen for user activity to reset session
  useEffect(() => {
    if (!token) return;

    const handleActivity = () => {
      resetSessionTimer();
    };

    window.addEventListener("click", handleActivity);
    window.addEventListener("keydown", handleActivity);

    return () => {
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("keydown", handleActivity);
    };
  }, [token, resetSessionTimer]);

  const login = (newToken: string, newUser: AuthUser, lastLogin?: string | null, sessionExpiryMinutes?: number) => {
    const duration = (sessionExpiryMinutes || DEFAULT_SESSION_MINUTES) * 60 * 1000;
    const expiry = Date.now() + duration;

    localStorage.setItem("auth_token", newToken);
    localStorage.setItem(SESSION_EXPIRY_KEY, String(expiry));
    localStorage.setItem(SESSION_DURATION_KEY, String(duration));
    if (lastLogin) localStorage.setItem(LAST_LOGIN_KEY, lastLogin);
    else localStorage.removeItem(LAST_LOGIN_KEY);

    // Wave 9B: persist scope data + apply default-pick logic
    writePersistedScopeData({
      scopedRoles: newUser.scopedRoles,
      accessibleZones: newUser.accessibleZones,
      accessibleDistricts: newUser.accessibleDistricts,
      accessibleClubs: newUser.accessibleClubs,
      districtClubAccess: newUser.districtClubAccess,
    });

    // Prefer a club where the user is actually an ADMIN — the club-admin dashboard requires admin
    // scope, not mere membership. accessibleClubs mixes both (admin clubs AND clubs the user is just
    // a member of), so defaulting to accessibleClubs[0] could land on a membership-only club and 403
    // every club-admin endpoint. Fall back to the first accessible club only if they admin none.
    const adminClubId = (newUser.scopedRoles ?? [])
      .filter((r) => (r.roleName === "Admin" || r.roleName === "Club Admin") && r.scope === "club" && !!r.clubId)
      .map((r) => r.clubId as number)
      .find((id) => (newUser.accessibleClubs ?? []).some((c) => c.id === id));
    const defaultClubId = adminClubId ?? defaultIdFromList(newUser.accessibleClubs);
    // Same rule for districts (was missing): prefer a district the user actually ADMINISTERS.
    // accessibleDistricts also includes districts the user only belongs to via club membership
    // — e.g. a District Admin who is also a member of the COG club lands district 548 (COG's
    // district) in the list. Defaulting to accessibleDistricts[0] could pick that member-only
    // district and 403 every district-admin endpoint. Fall back to the first only if they admin none.
    const adminDistrictId = (newUser.scopedRoles ?? [])
      .filter((r) => (r.roleName === "Admin" || r.roleName === "District Admin") && r.scope === "district" && !!r.districtId)
      .map((r) => r.districtId as number)
      .find((id) => (newUser.accessibleDistricts ?? []).some((d) => d.id === id));
    const defaultDistrictId = adminDistrictId ?? defaultIdFromList(newUser.accessibleDistricts);
    const defaultZoneId = defaultIdFromList(newUser.accessibleZones);
    writeNumericLs(SELECTED_CLUB_ID_KEY, defaultClubId);
    writeNumericLs(SELECTED_DISTRICT_ID_KEY, defaultDistrictId);
    writeNumericLs(SELECTED_ZONE_ID_KEY, defaultZoneId);

    setToken(newToken);
    setUser(newUser);
    setLastLoginTime(lastLogin || null);
    setSelectedClubId(defaultClubId);
    setSelectedDistrictId(defaultDistrictId);
    setSelectedZoneId(defaultZoneId);
    logoutCalledRef.current = false;
    startTimer();

    // Fire-and-forget refresh — login response may have minimal scope if backend isn't fully on Wave 9A
    void refreshScopeFromMyContext();
  };

  const logout = () => {
    doLogout();
  };

  // Wave 9B: imperative scope-selection API
  const selectScope = useCallback((scope: SelectScopeArgs) => {
    if (scope.clubId !== undefined) {
      const v = scope.clubId === null ? null : scope.clubId;
      setSelectedClubId(v);
      writeNumericLs(SELECTED_CLUB_ID_KEY, v);
    }
    if (scope.districtId !== undefined) {
      const v = scope.districtId === null ? null : scope.districtId;
      setSelectedDistrictId(v);
      writeNumericLs(SELECTED_DISTRICT_ID_KEY, v);
    }
    if (scope.zoneId !== undefined) {
      const v = scope.zoneId === null ? null : scope.zoneId;
      setSelectedZoneId(v);
      writeNumericLs(SELECTED_ZONE_ID_KEY, v);
    }
  }, []);

  const isAuthenticated = !!token && !!user;
  const isSuperAdmin = user?.roles?.includes("SuperAdmin") ?? false;
  const isAdmin = user?.roles?.includes("Admin") ?? false;
  const isZonalCoordinator = user?.roles?.includes("ZonalCoordinator") ?? false;
  const isRIDirector = user?.roles?.includes("RIDirector") ?? false;
  const isAG = user?.roles?.includes("AG") ?? false;
  const isClubModerator = user?.roles?.includes("ClubModerator") ?? false;

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      token,
      isAuthenticated,
      isSuperAdmin,
      isAdmin,
      isZonalCoordinator,
      isRIDirector,
      isAG,
      isClubModerator,
      loading,
      lastLoginTime,
      sessionRemaining,
      selectedClubId,
      selectedDistrictId,
      selectedZoneId,
      selectScope,
      login,
      logout,
      resetSessionTimer,
    }),
    // login/logout are defined inline above — they're stable enough for downstream consumers,
    // and we intentionally re-emit when any visible field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      user,
      token,
      isAuthenticated,
      isSuperAdmin,
      isAdmin,
      isZonalCoordinator,
      isRIDirector,
      isAG,
      isClubModerator,
      loading,
      lastLoginTime,
      sessionRemaining,
      selectedClubId,
      selectedDistrictId,
      selectedZoneId,
      selectScope,
      resetSessionTimer,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Wave 9B: scope-aware helper hooks
// ---------------------------------------------------------------------------

/** The currently-selected club info (selected → borrowed → first accessible → null). */
export function useSelectedClub(): ClubScopeDto | null {
  const { user, selectedClubId } = useAuth();
  return useMemo(() => {
    const clubs = user?.accessibleClubs ?? [];
    if (selectedClubId !== null) {
      const found = clubs.find((c) => c.id === selectedClubId);
      if (found) return found;
      // Not one of their own clubs — they're viewing a borrowed one (see ACTIVE_CLUB_KEY).
      const borrowed = readBorrowedScope(ACTIVE_CLUB_KEY);
      if (borrowed && borrowed.id === selectedClubId) return { id: borrowed.id, name: borrowed.name };
    }
    return clubs[0] ?? null;
  }, [user?.accessibleClubs, selectedClubId]);
}

/** True if the user holds an Admin role scoped to any club. */
export function useHasClubAdminAnywhere(): boolean {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = user?.scopedRoles;
    if (!roles || roles.length === 0) return false;
    return roles.some(
      (r) =>
        (r.roleName === "Admin" || r.roleName === "Club Admin") &&
        r.scope === "club" &&
        !!r.clubId,
    );
  }, [user?.scopedRoles]);
}

/** Clubs where the user holds a club-scoped Admin role. */
export function useClubAdminClubs(): ClubScopeDto[] {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = user?.scopedRoles;
    const clubs = user?.accessibleClubs;
    if (!roles || !clubs || clubs.length === 0) return [];
    const ids = new Set<number>();
    for (const r of roles) {
      if ((r.roleName === "Admin" || r.roleName === "Club Admin") && r.scope === "club" && r.clubId) {
        ids.add(r.clubId);
      }
    }
    return clubs.filter((c) => ids.has(c.id));
  }, [user?.scopedRoles, user?.accessibleClubs]);
}

/** The currently-selected district info (selected → borrowed → first accessible → null). */
export function useSelectedDistrict(): DistrictScopeDto | null {
  const { user, selectedDistrictId } = useAuth();
  return useMemo(() => {
    const districts = user?.accessibleDistricts ?? [];
    if (selectedDistrictId !== null) {
      const found = districts.find((d) => d.id === selectedDistrictId);
      if (found) return found;
      // Not one of their own districts — borrowed via global search (see ACTIVE_DISTRICT_KEY).
      const borrowed = readBorrowedScope(ACTIVE_DISTRICT_KEY);
      if (borrowed && borrowed.id === selectedDistrictId) return { id: borrowed.id, number: borrowed.name };
    }
    return districts[0] ?? null;
  }, [user?.accessibleDistricts, selectedDistrictId]);
}

/** True if the user holds an Admin role scoped to any district. */
export function useHasDistrictAdminAnywhere(): boolean {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = user?.scopedRoles;
    if (!roles || roles.length === 0) return false;
    return roles.some(
      (r) =>
        (r.roleName === "Admin" || r.roleName === "District Admin") &&
        r.scope === "district" &&
        !!r.districtId,
    );
  }, [user?.scopedRoles]);
}

/** Districts where the user holds a district-scoped Admin role. */
export function useDistrictAdminDistricts(): DistrictScopeDto[] {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = user?.scopedRoles;
    const districts = user?.accessibleDistricts;
    if (!roles || !districts || districts.length === 0) return [];
    const ids = new Set<number>();
    for (const r of roles) {
      if ((r.roleName === "Admin" || r.roleName === "District Admin") && r.scope === "district" && r.districtId) {
        ids.add(r.districtId);
      }
    }
    return districts.filter((d) => ids.has(d.id));
  }, [user?.scopedRoles, user?.accessibleDistricts]);
}

/** Distinct districts where the user is an AG. Derived from scopedRoles where
 *  roleName === "AG" and districtId is set. Deduped by districtId; preserves
 *  the order encountered in scopedRoles. Empty when the user is not an AG. */
export function useAgDistricts(): { id: number; number: string }[] {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = user?.scopedRoles;
    if (!roles || roles.length === 0) return [];
    const seen = new Set<number>();
    const result: { id: number; number: string }[] = [];
    for (const r of roles) {
      if (r.roleName === "AG" && r.districtId != null && !seen.has(r.districtId)) {
        seen.add(r.districtId);
        result.push({ id: r.districtId, number: r.districtNumber ?? `D${r.districtId}` });
      }
    }
    return result;
  }, [user?.scopedRoles]);
}
