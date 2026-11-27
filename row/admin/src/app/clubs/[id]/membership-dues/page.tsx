"use client";

import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMembershipDuesList, exportMembershipDuesReport, getClub, duesPayPath } from "@/services/api";
import { fileTimestamp } from "@/lib/dateUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Pencil, FileSpreadsheet, Users } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { withBase, BASE_PATH } from "@/lib/basePath";

import { LinkButton } from "@/components/ui/text-buttons"
import { IconButton } from "@/components/ui/icon-button"
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
    const url = `${window.location.origin}${BASE_PATH}${duesPayPath(item)}`;
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
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <PageHeader
          title={<>{clubName ? `${clubName} - ` : ""}Club Dues</>}
          back={`/clubs/${clubId}/dashboard`}
          actions={
            <>
<p className="text-muted-foreground text-base">View club dues for this club</p>
<Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/invoices`}>Invoices and statements</Link>
          </Button>
<NativeSelect
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="w-auto"
          >
            <option value="">All Years</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </NativeSelect>
<SearchBox value={search} onChange={setSearch} placeholder="Search..." className="w-64" />
            </>
          }
        />

        {loading ? (
          <div className="flex justify-center py-10"><ListPageSkeleton /></div>
        ) : !loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="text-center max-w-lg space-y-3">
              <h3 className="row-h2">Collect 100% of Your Club Dues Without a Single Follow-up Call</h3>
              <p className="text-muted-foreground">Club dues collection has not been set up for this club yet. Click below to learn more about our automated dues collection system.</p>
            </div>
            <Button size="lg" className="text-lg" onClick={() => window.open("https://club.example.org/", "_blank")}>
              Learn More
            </Button>
          </div>
        ) : (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Sr. No.</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-center">Paid</TableHead>
                  <TableHead className="text-center">Unpaid</TableHead>
                  <TableHead className="text-center">Members</TableHead>
                  <TableHead className="text-center">Edit</TableHead>
                  <TableHead className="text-center">View | Copy URL</TableHead>
                  <TableHead className="text-center">Report</TableHead>
                  <TableHead className="text-center">Report Link</TableHead>
                  <TableHead className="text-center">GoogleSheet</TableHead>
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
                      <IconButton onClick={() => router.push(`/clubs/${clubId}/membership-dues/${item.id}/members`)}
                        type="button" aria-label="Members">
                        <Users className="h-5 w-5" />
                      </IconButton>
                    </TableCell>

                    {/* Edit - Admin edits title/images */}
                    <TableCell className="text-center">
                      <IconButton onClick={() => router.push(`/clubs/${clubId}/membership-dues/edit/${item.id}`)}
                        type="button" aria-label="Edit">
                        <Pencil className="h-5 w-5" />
                      </IconButton>
                    </TableCell>

                    {/* View | Copy URL */}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-sm">
                        <LinkButton onClick={() => window.open(withBase(duesPayPath(item)), "_blank")}>View</LinkButton>
                        <span className="text-muted-foreground">|</span>
                        <LinkButton onClick={() => handleCopyUrl(item)}>Copy URL</LinkButton>
                      </div>
                    </TableCell>

                    {/* Report - Download CSV */}
                    <TableCell className="text-center">
                      <IconButton onClick={async () => {
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
                        type="button" aria-label="Download report">
                        <FileSpreadsheet className="h-5 w-5" />
                      </IconButton>
                    </TableCell>

                    {/* Report Link */}
                    <TableCell className="text-center">
                      <LinkButton onClick={() => {
                        const url = `${window.location.origin}${BASE_PATH}/report/dues/${item.id}`;
                        navigator.clipboard.writeText(url);
                        setSuccessMessage("Report link copied.");
                      }}>
                        Copy URL
                      </LinkButton>
                    </TableCell>

                    {/* GoogleSheet - Open/Copy only if exists, otherwise dash */}
                    <TableCell className="text-center">
                      {item.googleSheetId ? (
                        <div className="flex flex-col items-center gap-0.5 text-sm">
                          <LinkButton onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`, "_blank")}>Open</LinkButton>
                          <LinkButton onClick={() => { navigator.clipboard.writeText(`https://docs.google.com/spreadsheets/d/${item.googleSheetId}`); setSuccessMessage("Google Sheet URL copied."); }}>Copy URL</LinkButton>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  );
}
