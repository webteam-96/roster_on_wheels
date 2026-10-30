"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMembershipDuesList, exportMembershipDuesReport, getClub } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Pencil, FileSpreadsheet, Users } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

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

export default function ClubMembershipDuesPage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const [items, setItems] = useState<MembershipDuesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clubName, setClubName] = useState("");

  useEffect(() => {
    getClub(clubId).then(c => setClubName(c.clubName || "")).catch(() => {});
  }, [clubId]);

  // Note: year filter is NOT sent to API — applied client-side only, so the
  // year dropdown keeps all available years after selection.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMembershipDuesList({ clubId, search: search || undefined });
      setItems(data);
    } catch { setErrorMessage("Failed to load club dues"); }
    finally { setLoading(false); }
  }, [clubId, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopyUrl = (item: MembershipDuesItem) => {
    const url = `${window.location.origin}/pay/dues/${item.id}`;
    navigator.clipboard.writeText(url);
    setSuccessMessage("URL copied to clipboard.");
  };

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach(i => { if (i.rotaryYear) years.add(i.rotaryYear); });
    return Array.from(years).sort().reverse();
  }, [items]);

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    const matchesSearch = (i.purpose || "").toLowerCase().includes(q) ||
      (i.districtNumber || "").toLowerCase().includes(q) ||
      (i.clubName || "").toLowerCase().includes(q);
    const matchesYear = !yearFilter || i.rotaryYear === yearFilter;
    return matchesSearch && matchesYear;
  });

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">{clubName ? `${clubName} - ` : ""}Club Dues</h2>
            <p className="text-muted-foreground text-base">View club dues for this club</p>
          </div>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All Years</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : !loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="text-center max-w-lg space-y-3">
              <h3 className="text-2xl font-bold text-primary">Collect 100% of Your Club Dues Without a Single Follow-up Call</h3>
              <p className="text-muted-foreground">Club dues collection has not been set up for this club yet. Click below to learn more about our automated dues collection system.</p>
            </div>
            <Button size="lg" className="text-lg px-8 py-6" onClick={() => window.open("https://club.example.org/", "_blank")}>
              Learn More
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary text-primary-foreground hover:bg-primary">
                  <TableHead className="text-primary-foreground w-[50px]">Sr. No.</TableHead>
                  <TableHead className="text-primary-foreground">Year</TableHead>
                  <TableHead className="text-primary-foreground">Title</TableHead>
                  <TableHead className="text-primary-foreground text-center">Paid</TableHead>
                  <TableHead className="text-primary-foreground text-center">Unpaid</TableHead>
                  <TableHead className="text-primary-foreground text-center">Members</TableHead>
                  <TableHead className="text-primary-foreground text-center">Edit</TableHead>
                  <TableHead className="text-primary-foreground text-center">View | Copy URL</TableHead>
                  <TableHead className="text-primary-foreground text-center">Report</TableHead>
                  <TableHead className="text-primary-foreground text-center">Report Link</TableHead>
                  <TableHead className="text-primary-foreground text-center">GoogleSheet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No club dues found</TableCell></TableRow>
                ) : filtered.map((item, index) => (
                  <TableRow key={item.id} className="border-b">
                    {/* Sr. No. */}
                    <TableCell className="text-center">{index + 1}</TableCell>

                    {/* Year */}
                    <TableCell>{item.rotaryYear || ""}</TableCell>

                    {/* Title */}
                    <TableCell className="font-medium">{item.purpose || ""}</TableCell>

                    {/* Paid */}
                    <TableCell className="text-center font-medium text-green-600">{item.paidCount}</TableCell>

                    {/* Unpaid */}
                    <TableCell className="text-center font-medium text-red-600">{item.unpaidCount}</TableCell>

                    {/* Members - read-only view */}
                    <TableCell className="text-center">
                      <button onClick={() => router.push(`/clubs/${clubId}/membership-dues/${item.id}/members`)}
                        className="inline-flex items-center justify-center">
                        <Users className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Edit - Admin edits title/images */}
                    <TableCell className="text-center">
                      <button onClick={() => router.push(`/clubs/${clubId}/membership-dues/edit/${item.id}`)}
                        className="inline-flex items-center justify-center">
                        <Pencil className="h-5 w-5 text-blue-500 hover:text-blue-700 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <button onClick={() => window.open(`/pay/dues/${item.id}`, "_blank")}
                          className="text-blue-600 hover:text-blue-800 hover:underline">View</button>
                        <span className="text-muted-foreground">|</span>
                        <button onClick={() => handleCopyUrl(item)}
                          className="text-blue-600 hover:text-blue-800 hover:underline">Copy URL</button>
                      </div>
                    </TableCell>

                    {/* Report - Download CSV */}
                    <TableCell className="text-center">
                      <button onClick={async () => {
                        try {
                          const blob = await exportMembershipDuesReport(item.id);
                          const url = window.URL.createObjectURL(new Blob([blob]));
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `membership-dues-${item.id}_${fileTimestamp()}.csv`;
                          a.click();
                          window.URL.revokeObjectURL(url);
                        } catch { setErrorMessage("Failed to download report."); }
                      }}
                        className="inline-flex items-center justify-center">
                        <FileSpreadsheet className="h-5 w-5 text-red-600 hover:text-red-800 cursor-pointer" />
                      </button>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <button onClick={() => {
                        const url = `${window.location.origin}/report/dues/${item.id}`;
                        navigator.clipboard.writeText(url);
                        setSuccessMessage("Report link copied.");
                      }} className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
                        Copy URL
                      </button>
                    </TableCell>

                    {/* GoogleSheet - Open/Copy only if exists, otherwise dash */}
                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <button onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Open</button>
                          <button onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}
                            className="text-blue-600 hover:text-blue-800 hover:underline">Copy URL</button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
