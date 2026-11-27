"use client";

/**
 * Club Dues v2 listing — Club Admin facing.
 *
 * V1 logic preserved verbatim — same API calls, same year filter, same
 * search, same per-row actions. Only the visual presentation changes
 * (ClubAdminShell chrome, KPI tiles, dense slate table).
 *
 * Per Club Admin permission rule (memory: "Club Admin can only view/edit,
 * not create/delete modules created by SuperAdmin") the listing has:
 *   - NO Add button
 *   - NO Delete action
 * Edit, View, Copy URL, Report download, Report Link, Members and
 * Google Sheet links are all preserved.
 *
 * v2 reads ONLY `?returnTo=` — never any other param name.
 */

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Pencil, FileSpreadsheet, Users, Search, Wallet, CheckCircle2, AlertCircle, ExternalLink, Copy, X } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import {
  getMembershipDuesList, exportMembershipDuesReport, getClub,
  duesPayPath,
} from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import KpiCard from "@/components/dashboard/KpiCard";
import { fmtInt } from "@/components/dashboard/formatters";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { withBase, BASE_PATH } from "@/lib/basePath";

import { ClearButton, LinkButton } from "@/components/ui/text-buttons"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
interface MembershipDuesItem {
  id: number;
  districtNumber?: string;
  clubName?: string;
  rotaryYear?: string;
  purpose?: string;
  memberCount: number;
  paidCount: number;
  unpaidCount: number;
  isActive: boolean;
  weblinkUrl?: string;
  googleSheetId?: string;
  createdDate: string;
}

export default function ClubMembershipDuesV2Page() {
  useSyncClubIdFromUrl();
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);

  const [items, setItems] = useState<MembershipDuesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [clubName, setClubName] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-hop returnTo chain: dashboard → listing → edit/members → listing → dashboard.
  // childReturnTo points at THIS listing (with parent's returnTo nested inside),
  // so save goes back to the listing, then user clicks back → dashboard.
  const parentReturnTo = searchParams.get("returnTo") || "";
  const myListingUrl = `/clubs/${clubId}/membership-dues/v2${parentReturnTo ? `?returnTo=${encodeURIComponent(parentReturnTo)}` : ""}`;
  const returnTo = encodeURIComponent(myListingUrl);

  useEffect(() => {
    getClub(clubId).then((c) => setClubName(c.clubName || "")).catch(() => {});
  }, [clubId]);

  // Note: year filter is NOT sent to API — applied client-side only, so the
  // year dropdown keeps all available years after selection.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMembershipDuesList({
        clubId,
        search: search || undefined,
      });
      setItems(data);
    } catch {
      setErrorMessage("Failed to load club dues");
    } finally {
      setLoading(false);
    }
  }, [clubId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounce search input → committed search (400ms after last keystroke).
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const handleCopyUrl = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}${BASE_PATH}${duesPayPath(item)}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const handleCopyReportLink = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}${BASE_PATH}/report/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("Report link copied.");
  };

  const handleDownloadReport = async (item: MembershipDuesItem) => {
    try {
      const blob = await exportMembershipDuesReport(item.id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `membership-dues-${item.id}_${fileTimestamp()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Failed to download report.");
    }
  };

  // Filter items locally too (V1 parity: search box filters both server + client)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => {
      const matchesSearch = !q ||
        (i.purpose || "").toLowerCase().includes(q) ||
        (i.districtNumber || "").toLowerCase().includes(q) ||
        (i.clubName || "").toLowerCase().includes(q);
      const matchesYear = !yearFilter || i.rotaryYear === yearFilter;
      return matchesSearch && matchesYear;
    });
  }, [items, search, yearFilter]);

  // Year dropdown — data-only (memory: never pad with rotary_year_master)
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((i) => { if (i.rotaryYear) years.add(i.rotaryYear); });
    return Array.from(years).sort().reverse();
  }, [items]);

  // KPI aggregates across all items (not filtered — total picture)
  const kpiTotalRecords = items.length;
  const kpiPaid = items.reduce((sum, i) => sum + (i.paidCount || 0), 0);
  const kpiUnpaid = items.reduce((sum, i) => sum + (i.unpaidCount || 0), 0);
  const kpiMembers = items.reduce((sum, i) => sum + (i.memberCount || 0), 0);

  if (!isSuperAdmin && !isAdmin) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Club Dues"
          pageSubtitle="Manage member dues and reminders"
          activeNavHref="/club-admin-dashboard/membership-dues"
        >
          <div className="flex flex-col items-center justify-center py-20">
            <h3 className="row-h2">Access Denied</h3>
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Club Dues"
        pageSubtitle="Manage member dues and reminders"
        activeNavHref="/club-admin-dashboard/membership-dues"
      >
        <div className="space-y-5">
          {/* Header */}
          <PageHeader title="Club Dues" description={<>{clubName || "–"} · View &amp; manage member dues collection</>} back={`/clubs/${clubId}/dashboard`} />

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Dues Records" value={fmtInt(kpiTotalRecords)} subtitle="Active dues" icon={Wallet}        color="blue" />
            <KpiCard title="Paid Members"       value={fmtInt(kpiPaid)}         subtitle="Across all years" icon={CheckCircle2} color="green" />
            <KpiCard title="Unpaid Members"     value={fmtInt(kpiUnpaid)}       subtitle="Pending collection" icon={AlertCircle}  color="red" />
            <KpiCard title="Total Members"      value={fmtInt(kpiMembers)}      subtitle="On rolls" icon={Users}        color="purple" />
          </div>

          {/* Empty state (no dues at all) */}
          {!loading && items.length === 0 && (
            <Card className="p-10 flex flex-col items-center justify-center space-y-5">
              <div className="text-center max-w-lg space-y-3">
                <h3 className="row-h2">
                  Collect 100% of Your Club Dues Without a Single Follow-up Call
                </h3>
                <p className="text-sm text-slate-500">
                  Club dues collection has not been set up for this club yet. Click below
                  to learn more about our automated dues collection system.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => window.open("https://club.example.org/", "_blank")}
                
              >
                Learn More
              </Button>
            </Card>
          )}

          {/* Table card */}
          {(loading || items.length > 0) && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="row-h3">Dues Records</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Manage dues per Rotary year · {filtered.length} record{filtered.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="w-auto"
                  >
                    <option value="">All Years</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </NativeSelect>
                  <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="Search title or year…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pl-7 pr-7 sm:w-56"
                    />
                    {searchInput && (
                      <ClearButton
                        type="button"
                        onClick={() => setSearchInput("")}
                        aria-label="Clear search" />
                    )}
                  </div>
                  {/*
                    NO Add button: Club Admin can only view/edit dues records,
                    not create them — those are seeded by SuperAdmin.
                  */}
                </div>
              </div>

              <div className="overflow-x-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <RotaryLoader size="md" label="Loading dues records…" />
                  </div>
                ) : (
                  <Table className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left w-10">Sr</TableHead>
                        <TableHead className="text-left">Year</TableHead>
                        <TableHead className="text-left">Title</TableHead>
                        <TableHead className="text-center">Paid</TableHead>
                        <TableHead className="text-center">Unpaid</TableHead>
                        <TableHead className="text-center">Members</TableHead>
                        <TableHead className="text-center">Edit</TableHead>
                        <TableHead className="text-center">Payment Page</TableHead>
                        <TableHead className="text-center">Report</TableHead>
                        <TableHead className="text-center">Report Link</TableHead>
                        <TableHead className="text-center">Google Sheet</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                            No club dues match your filters.
                          </TableCell>
                        </TableRow>
                      ) : filtered.map((item, idx) => (
                        <TableRow key={item.id}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell className="whitespace-nowrap">{item.rotaryYear || "–"}</TableCell>
                          <TableCell className="font-medium">{item.purpose || "–"}</TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {fmtInt(item.paidCount)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                              {fmtInt(item.unpaidCount)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <IconButton
                              type="button"
                              onClick={() =>
                                router.push(`/clubs/${clubId}/membership-dues/v2/${item.id}/members?returnTo=${returnTo}`)
                              }
                               aria-label="View members"
                              title="View members"
                            >
                              <Users size={14} />
                            </IconButton>
                          </TableCell>
                          <TableCell className="text-center">
                            <IconButton
                              type="button"
                              onClick={() =>
                                router.push(`/clubs/${clubId}/membership-dues/v2/edit/${item.id}?returnTo=${returnTo}`)
                              }
                               aria-label="Edit dues record"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </IconButton>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="inline-flex items-center gap-2 text-xs">
                              <LinkButton
                                type="button"
                                onClick={() => window.open(withBase(duesPayPath(item)), "_blank")}
                                 title="Open payment page">
                                <ExternalLink size={12} /> View
                              </LinkButton>
                              <span className="text-slate-300">|</span>
                              <LinkButton
                                type="button"
                                onClick={() => handleCopyUrl(item)}
                                 title="Copy payment page URL">
                                <Copy size={12} /> Copy
                              </LinkButton>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <IconButton
                              type="button"
                              onClick={() => handleDownloadReport(item)}
                              className="hover:text-red-700"
                              aria-label="Download CSV report"
                              title="Download CSV"
                            >
                              <FileSpreadsheet size={14} />
                            </IconButton>
                          </TableCell>
                          <TableCell className="text-center">
                            <LinkButton
                              type="button"
                              onClick={() => handleCopyReportLink(item)}
                               title="Copy report URL"
                             size="sm">
                              <Copy size={12} /> Copy URL
                            </LinkButton>
                          </TableCell>
                          <TableCell className="text-center">
                            {item.googleSheetId ? (
                              <div className="inline-flex flex-col items-center gap-0.5 text-xs">
                                <LinkButton
                                  type="button"
                                  onClick={() =>
                                    window.open(
                                      `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`,
                                      "_blank"
                                    )
                                  }
                                   title="Open Google Sheet">
                                  <ExternalLink size={12} /> Open
                                </LinkButton>
                                <LinkButton
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `https://docs.google.com/spreadsheets/d/${item.googleSheetId}`
                                    );
                                    setSuccessMessage("Google Sheet URL copied.");
                                  }}
                                   title="Copy Google Sheet URL">
                                  <Copy size={12} /> Copy URL
                                </LinkButton>
                              </div>
                            ) : (
                              <span className="text-slate-300">–</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="px-5 py-2.5 border-t border-slate-100 text-xs text-slate-500">
                {filtered.length} record{filtered.length === 1 ? "" : "s"}
              </div>
            </Card>
          )}

          <SuccessAlert
            open={!!successMessage}
            title="Success"
            description={successMessage || ""}
            onOk={() => setSuccessMessage(null)}
          />
          <ErrorAlert
            open={!!errorMessage}
            title="Error"
            description={errorMessage || ""}
            onOk={() => setErrorMessage(null)}
          />
        </div>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
