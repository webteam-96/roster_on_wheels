"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, BadgeCheck, Crown, Search, Eye, X, Pencil,
  Mail, Phone, IdCard, Cake, Heart, Droplet, Briefcase, CalendarDays,
  UserCircle2, UserSquare2, ShieldCheck, ShieldOff, MapPin,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getClubAdminDashboardDirectory, getMember, getPhotoUrl, assignRole, removeRole, setClubMemberHonorary } from "@/services/api";
import type {
  ClubAdminDashboardDirectoryResponse,
  ClubAdminDashboardDirectoryMemberRow,
} from "@/types/clubAdminDashboard";
import type { Member } from "@/types/member";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import { formatBirthAnniversary } from "@/lib/dateUtils";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_STORAGE_KEY = "directory_page_size";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

function MemberRow({
  row, onView, canEdit, clubId, onMakeAdmin, onRemoveAdmin, roleActionLoading,
}: {
  row: ClubAdminDashboardDirectoryMemberRow;
  onView: (row: ClubAdminDashboardDirectoryMemberRow) => void;
  // Pencil shows only when the current user has edit rights (SA + Club Admin).
  // Backend partial-edit gate enforces the 10-field lock for Club Admin.
  canEdit: boolean;
  clubId: number | null;
  onMakeAdmin: (row: ClubAdminDashboardDirectoryMemberRow) => void;
  onRemoveAdmin: (row: ClubAdminDashboardDirectoryMemberRow) => void;
  roleActionLoading: boolean;
}) {
  // V2 edit form — same UI as the V2 Add page, but loads existing member +
  // calls update. Partial-edit lock for Club Admin is enforced client-side
  // (field disabled) AND server-side (strip on save).
  // returnTo: after Save / Cancel, V2FormShell honours `?returnTo=` and brings
  // the user back HERE (the dashboard Directory tab) instead of bouncing to
  // the legacy /clubs/{id}/members listing.
  const returnTo = encodeURIComponent("/club-admin-dashboard/dashboard/directory");
  const editHref = clubId
    ? `/members/edit-v2/${row.memberId}?clubId=${clubId}&returnTo=${returnTo}`
    : `/members/edit-v2/${row.memberId}?returnTo=${returnTo}`;
  return (
    <tr className="border-t border-slate-100 hover:bg-blue-50/40">
      <td className="px-4 py-2">
        {row.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getPhotoUrl(row.photoPath)} alt={row.name} className="w-9 h-9 rounded-full object-cover border border-slate-200" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center">
            {initials(row.name) || "—"}
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="font-medium text-slate-800">{row.name}</p>
          {/* Role tags. Honorary chip removed per user spec 2026-06-26 — honorary
              status is per-club and managed via SuperAdmin toggle in the detail
              dialog, not shown as an inline tag. */}
          {row.isClubAdmin && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">admin</span>
          )}
          {row.isDistrictAdmin && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-indigo-700 bg-indigo-100 border border-indigo-200 rounded px-1.5 py-0.5">district admin</span>
          )}
        </div>
        {row.designation && (
          <p className="text-xs text-slate-500">{row.designation}</p>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">{row.mobile ?? "—"}</td>
      <td className="px-4 py-2 text-xs text-slate-600">{row.email ?? "—"}</td>
      <td className="px-4 py-2 w-24 text-right">
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onView(row)}
            aria-label={`View details for ${row.name}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
          >
            <Eye size={15} />
          </button>
          {canEdit && (
            <Link
              href={editHref}
              aria-label={`Edit ${row.name}`}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-colors"
            >
              <Pencil size={14} />
            </Link>
          )}
          {/* Make/Remove Admin button — mirrors V1 /clubs/[id]/members.
              Remove only revokes admin in THIS club (sp_role_deactivate_admin
              filters by p_ClubId), never in other clubs the member may admin. */}
          {canEdit && !row.isClubAdmin && (
            <button
              type="button"
              onClick={() => onMakeAdmin(row)}
              disabled={roleActionLoading}
              aria-label={`Make ${row.name} an admin`}
              title="Make Admin"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 disabled:opacity-50 transition-colors"
            >
              {roleActionLoading ? <RotaryLoader size="sm" /> : <ShieldCheck size={14} />}
            </button>
          )}
          {canEdit && row.isClubAdmin && (
            <button
              type="button"
              onClick={() => onRemoveAdmin(row)}
              disabled={roleActionLoading}
              aria-label={`Remove admin role from ${row.name}`}
              title="Remove Admin (this club only)"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 transition-colors"
            >
              {roleActionLoading ? <RotaryLoader size="sm" /> : <ShieldOff size={14} />}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function DashboardDirectoryPage() {
  const { isSuperAdmin, isAdmin, selectedClubId } = useAuth();
  // SA always edits. Club Admin sees the pencil too — backend (MembersController
  // + UserPermissionHelper.DirectoryMemberLockedFields) silently locks the 10
  // identity fields server-side. Other roles see only the eye/view button.
  const canEdit = isSuperAdmin || isAdmin;
  const [data, setData] = useState<ClubAdminDashboardDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [viewRow, setViewRow] = useState<ClubAdminDashboardDirectoryMemberRow | null>(null);
  // Make-Admin in-flight tracker (memberId currently being promoted).
  const [makeAdminId, setMakeAdminId] = useState<number | null>(null);
  // Bump to force a refetch after a successful promotion.
  const [reloadTick, setReloadTick] = useState(0);

  const handleMakeAdmin = async (row: ClubAdminDashboardDirectoryMemberRow) => {
    const clubId = data?.club?.clubId;
    if (!clubId) return;
    if (!window.confirm(`Make ${row.name} an Admin of ${data?.club?.clubName ?? "this club"}?`)) return;
    try {
      setMakeAdminId(row.memberId);
      await assignRole({ memberId: row.memberId, roleId: 2, clubId });
      // Refetch the directory so the badge + sort order reflect the new admin.
      setReloadTick((t) => t + 1);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } | string } };
      const msg = typeof err?.response?.data === "string"
        ? err.response.data
        : err?.response?.data?.message;
      alert(msg || "Failed to assign Admin role.");
    } finally {
      setMakeAdminId(null);
    }
  };

  // Mirrors V1 /clubs/[id]/members handleRemoveAdmin — always passes the
  // current clubId so the backend (sp_role_deactivate_admin) only deactivates
  // this club's admin row, leaving the member's admin status in other clubs
  // intact. Credentials only get disabled if the member has no admin role
  // remaining ANYWHERE (handled server-side).
  const handleRemoveAdmin = async (row: ClubAdminDashboardDirectoryMemberRow) => {
    const clubId = data?.club?.clubId;
    if (!clubId) return;
    if (!window.confirm(`Remove Admin role from ${row.name} for ${data?.club?.clubName ?? "this club"}?\n\nThis only affects this club — admin access in other clubs (if any) is preserved.`)) return;
    try {
      setMakeAdminId(row.memberId);
      await removeRole({ memberId: row.memberId, roleId: 2, clubId });
      setReloadTick((t) => t + 1);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } | string } };
      const msg = typeof err?.response?.data === "string"
        ? err.response.data
        : err?.response?.data?.message;
      alert(msg || "Failed to remove Admin role.");
    } finally {
      setMakeAdminId(null);
    }
  };

  // Restore persisted page-size preference on mount.
  useEffect(() => {
    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY) : null;
      const n = stored ? parseInt(stored, 10) : NaN;
      if (Number.isFinite(n) && (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) {
        setPageSize(n);
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Scope to the SELECTED club — a multi-club admin must see only that club's
    // members. Without passing clubId the backend falls back to a default club,
    // and the list wouldn't switch when the admin swaps clubs.
    getClubAdminDashboardDirectory(null, selectedClubId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.message || "Failed to load directory."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadTick, selectedClubId]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const base = !q
      ? [...data.members]
      : data.members.filter((m) =>
          m.name.toLowerCase().includes(q) ||
          (m.email ?? "").toLowerCase().includes(q) ||
          (m.mobile ?? "").toLowerCase().includes(q)
        );
    // Item #6 of 2026-06-12 sort order:
    //   1) Club Admins  (alphabetical by name)
    //   2) Members with blank mobile  (alphabetical by name)
    //   3) Everyone else  (alphabetical by name)
    const groupKey = (m: ClubAdminDashboardDirectoryMemberRow) =>
      m.isClubAdmin ? 0 : (!m.mobile || m.mobile.trim() === "") ? 1 : 2;
    base.sort((a, b) => {
      const ga = groupKey(a), gb = groupKey(b);
      if (ga !== gb) return ga - gb;
      return a.name.localeCompare(b.name);
    });
    return base;
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search]);

  function handlePageSizeChange(next: number) {
    setPageSize(next);
    setPage(1);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
      }
    } catch {
      /* ignore storage errors */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" label="Loading directory…" />
      </div>
    );
  }
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Card sequence per user request (2026-06-12):
          Active Members (formerly "Paid Members" / "Full Members"), Male, Female, Honorary, Total Members */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Active Members"  value={fmtInt(data.fullMembers)}     subtitle="Active in club"             icon={BadgeCheck}  color="green"  />
        <KpiCard title="Male"          value={fmtInt(data.maleMembers)}     subtitle="Members"                    icon={UserCircle2} color="blue"   />
        <KpiCard title="Female"        value={fmtInt(data.femaleMembers)}   subtitle="Members"                    icon={UserSquare2} color="purple" />
        <KpiCard title="Honorary"      value={fmtInt(data.honoraryMembers)} subtitle="Not counted in total"       icon={Crown}       color="gold"   />
        <KpiCard title="Total Members" value={fmtInt(data.totalMembers)}    subtitle="Excludes honorary"          icon={Users}       color="blue"   />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Member Directory</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              All members · {data.club.clubName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search name, email or mobile…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                className="py-1.5 pl-2 pr-6 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {/*
              Per the Club Admin permission rule (members are SuperAdmin-managed
              only) the "+Add New" / "Add With Minimum Details" buttons are
              intentionally omitted from this tab. Read-only listing.
            */}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left w-16">Photo</th>
                <th className="px-4 py-2.5 text-left">Name</th>
                <th className="px-4 py-2.5 text-left">Mobile No.</th>
                <th className="px-4 py-2.5 text-left">Email</th>
                <th className="px-4 py-2.5 text-right w-24">{canEdit ? "Actions" : "View"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((m) => (
                <MemberRow
                  key={m.memberId}
                  row={m}
                  onView={setViewRow}
                  canEdit={canEdit}
                  clubId={data?.club?.clubId ?? null}
                  onMakeAdmin={handleMakeAdmin}
                  onRemoveAdmin={handleRemoveAdmin}
                  roleActionLoading={makeAdminId === m.memberId}
                />
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No members match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} members
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-100"
            >
              Prev
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`px-2.5 py-1 rounded border text-xs ${
                  n === safePage
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-100"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {viewRow && (
        <MemberDetailModal
          row={viewRow}
          clubId={data?.club?.clubId ?? 0}
          onClose={() => setViewRow(null)}
        />
      )}
    </div>
  );
}

// ─── View Member Details modal ──────────────────────────────────────────

function MemberDetailModal({
  row, clubId, onClose,
}: {
  row: ClubAdminDashboardDirectoryMemberRow;
  clubId: number;
  onClose: () => void;
}) {
  const { isSuperAdmin } = useAuth();
  const [profile, setProfile] = useState<Member | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Per-club honorary state — initialized from the directory row (which reads
  // cm.IsHonoraryMember on the server). SuperAdmin can toggle; Club Admin sees
  // it read-only. Optimistic update with rollback on API failure.
  const [honorary, setHonorary] = useState<boolean>(!!row.isHonorary);
  const [honorarySaving, setHonorarySaving] = useState(false);
  const [honoraryError, setHonoraryError] = useState<string | null>(null);

  const toggleHonorary = async () => {
    if (!isSuperAdmin || honorarySaving || !clubId) return;
    const next = !honorary;
    setHonorary(next);            // optimistic
    setHonorarySaving(true);
    setHonoraryError(null);
    try {
      await setClubMemberHonorary(clubId, row.memberId, next);
    } catch (err) {
      setHonorary(!next);         // rollback
      const msg = err instanceof Error ? err.message : "Failed to update honorary status.";
      setHonoraryError(msg);
    } finally {
      setHonorarySaving(false);
    }
  };

  // Fetch full profile for richer fields (birthDate, anniversary, bloodGroup, etc.)
  useEffect(() => {
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);
    getMember(row.memberId)
      .then((m) => { if (!cancelled) setProfile(m); })
      .catch(() => { if (!cancelled) setProfileError("Could not load extended profile — showing summary only."); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [row.memberId]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prefer profile photo (full path) over row.photoPath (already URL-prefixed by API)
  const photoSrc = profile?.profilePhotoPath
    ? getPhotoUrl(profile.profilePhotoPath)
    : (row.photoPath ?? "");

  const mobile = profile?.primaryMobileNumber
    ? `${profile.primaryCountryPhoneCode ?? ""} ${profile.primaryMobileNumber}`.trim()
    : (row.mobile ?? "—");
  const email      = profile?.emailId    ?? row.email   ?? "—";
  const rotaryId   = profile?.rotaryId   ?? row.rotaryId ?? "—";
  const gender     = profile?.gender     ?? row.gender   ?? "—";
  const bloodGroup = profile?.bloodGroup ?? "—";
  // Project rule: birthdays & anniversaries display DD-MM only — year is stored
  // in the DB and available in edit forms, but never shown on read surfaces.
  const birthDate  = formatBirthAnniversary(profile?.birthDate);
  const anniversary = formatBirthAnniversary(profile?.anniversaryDate);
  // Honorary is per-club (cm.IsHonoraryMember on the directory row) since 2026-06-26.
  // Local `honorary` state above drives both display and SuperAdmin toggle.

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-detail-title"
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoSrc}
                alt={row.name}
                className="w-14 h-14 rounded-full object-cover border-2 border-blue-100 flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-600 text-base font-semibold flex items-center justify-center border-2 border-blue-100 flex-shrink-0">
                {initials(row.name) || "—"}
              </div>
            )}
            <div className="min-w-0">
              <h2 id="member-detail-title" className="text-base font-semibold text-slate-800 truncate">
                {row.name}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {row.designation && (
                  <span className="text-xs text-slate-500">{row.designation}</span>
                )}
                {/* Honorary chip removed per Q1 2026-06-26 — status is shown
                    as a data field in the Membership section below. SuperAdmin
                    can toggle it from there. */}
                {row.isClubAdmin && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                    <ShieldCheck size={10} /> Club Admin
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {profileLoading && (
            <div className="flex items-center text-xs">
              <RotaryLoader size="sm" label="Loading full profile…" />
            </div>
          )}
          {profileError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {profileError}
            </div>
          )}

          {/* Contact Information */}
          <Section title="Contact Information" dotColor="bg-blue-500">
            <DetailField icon={Phone}     label="Mobile"    value={mobile} />
            <DetailField icon={Mail}      label="Email"     value={email} />
            <DetailField icon={IdCard}    label="Rotary ID" value={rotaryId} />
          </Section>

          {/* Personal Details */}
          <Section title="Personal Details" dotColor="bg-emerald-500">
            <DetailField icon={Users}   label="Gender"      value={gender} />
            <DetailField icon={Droplet} label="Blood Group" value={bloodGroup} />
            <DetailField icon={Cake}    label="Birth Date"  value={birthDate} />
            <DetailField icon={Heart}   label="Anniversary" value={anniversary} />
          </Section>

          {/* Membership */}
          <Section title="Membership" dotColor="bg-purple-500">
            <DetailField
              icon={Briefcase}
              label="Designation"
              value={row.designation || "—"}
            />
            <DetailField
              icon={CalendarDays}
              label="Joined Date"
              value={fmtDate(row.joinedDate)}
            />
            {/* Honorary status is per-club. SuperAdmin toggles inline (PATCH
                /api/clubs/{clubId}/members/{memberId}/honorary-status); Club
                Admin sees the same control disabled — read-only display. */}
            <div className="flex items-center gap-3">
              <Crown size={14} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Honorary Member</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={honorary}
                      onChange={toggleHonorary}
                      disabled={!isSuperAdmin || honorarySaving || !clubId}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <span>{honorary ? "Yes" : "No"}</span>
                  </label>
                  {honorarySaving && <span className="text-[10px] text-slate-500">Saving…</span>}
                  {!isSuperAdmin && (
                    <span className="text-[10px] text-slate-400 italic">(SuperAdmin only)</span>
                  )}
                </div>
                {honoraryError && (
                  <p className="mt-1 text-[10px] text-red-600">{honoraryError}</p>
                )}
              </div>
            </div>
            <DetailField
              icon={ShieldCheck}
              label="Club Admin"
              value={row.isClubAdmin ? "Yes" : "No"}
            />
          </Section>

          {/* Address(es) */}
          {profile?.addresses && profile.addresses.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Address</h3>
              </div>
              <div className="space-y-3 pl-3">
                {profile.addresses.map((a) => (
                  <div key={a.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <MapPin size={12} className="text-slate-400" />
                      <span className="font-semibold text-slate-700">{a.addressType}</span>
                    </div>
                    <p className="text-slate-600">{[a.address, a.city, a.state, a.pinCode, a.country].filter(Boolean).join(", ") || "—"}</p>
                    {a.phoneNumber && <p className="text-slate-500 mt-0.5">Phone: {`${a.countryPhoneCode ?? ""} ${a.phoneNumber}`.trim()}</p>}
                    {a.businessName && <p className="text-slate-500 mt-0.5">Business: {a.businessName}</p>}
                    {a.businessEmailId && <p className="text-slate-500">Email: {a.businessEmailId}</p>}
                    {a.keywords && <p className="text-slate-500">Keywords: {a.keywords}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Family */}
          {profile?.familyMembers && profile.familyMembers.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Family</h3>
              </div>
              <div className="space-y-2 pl-3">
                {profile.familyMembers.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs flex items-center gap-3">
                    {f.photoPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getPhotoUrl(f.photoPath)} alt={f.name} className="w-9 h-9 rounded-full object-cover border flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">{initials(f.name)}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-700 truncate">{f.name} <span className="font-normal text-slate-500">· {f.relation}</span></p>
                      <p className="text-slate-500 truncate">{[f.phoneNumber && `${f.countryPhoneCode ?? ""} ${f.phoneNumber}`.trim(), f.emailId].filter(Boolean).join(" · ") || "—"}</p>
                      {(f.birthDate || f.bloodGroup) && (
                        <p className="text-slate-400 text-[11px]">{[f.bloodGroup, f.birthDate && `Birthday ${formatBirthAnniversary(f.birthDate)}`].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex justify-end bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title, dotColor, children,
}: {
  title: string;
  dotColor: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-3">
        {children}
      </div>
    </section>
  );
}

function DetailField({
  icon: Icon, label, value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wide font-medium">
        <Icon size={11} className="text-slate-400" />
        <span>{label}</span>
      </div>
      <p className="text-sm text-slate-800 font-medium mt-0.5 break-words">
        {value || "—"}
      </p>
    </div>
  );
}
