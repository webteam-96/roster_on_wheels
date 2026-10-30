"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { TerminatedMember } from "@/types/club";
import { getClub, getTerminatedMembers } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Pagination from "@/components/Pagination";
import { ArrowLeft, Search, UserX, X, Download } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import * as XLSX from "xlsx-js-style";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
export default function TerminatedMembersPage() {
  const params = useParams();
  const clubId = Number(params.id);

  const [clubName, setClubName] = useState("");
  const [members, setMembers] = useState<TerminatedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    async function fetchClub() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch {
        // ignore
      }
    }
    fetchClub();
  }, [clubId]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTerminatedMembers(clubId, page, pageSize, search || undefined);
      setMembers(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setMembers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      // Fetch all terminated members (large page size to get all)
      const result = await getTerminatedMembers(clubId, 1, 100000);
      const rows = result.items.map((m, i) => ({
        "S.No.": i + 1,
        "Member ID": m.rotaryId || "-",
        "Member Name": m.memberName,
        "Joined Date": formatDate(m.joinedDate),
        "Termination Date": formatDate(m.terminationDate),
        "Termination Reason": m.terminationReason || "-",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Terminated Members");
      XLSX.writeFile(wb, `${clubName || "Club"}_Terminated_Members.xlsx`);
    } catch {
      // ignore
    } finally {
      setExporting(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/rotary-network`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {clubName ? `${clubName} - Terminated Members` : "Terminated Members"}
            </h2>
            <p className="text-muted-foreground text-base">Members terminated from this club</p>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or Rotary ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
            {searchInput && (
              <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
          <Button onClick={handleSearch} size="sm">Search</Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={exporting || totalCount === 0}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Exporting..." : "Export Excel"}
          </Button>
        </div>

        {!loading && members.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Filter members..." />
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserX className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No terminated members</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No members found matching your search." : "No terminated members found for this club."}
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && members.length > 0 && (() => {
          const q = searchQuery.toLowerCase();
          const filteredMembers = q
            ? members.filter((member) =>
                [member.rotaryId, member.memberName, member.terminationReason]
                  .some((val) => val && String(val).toLowerCase().includes(q))
              )
            : members;
          return (
            <>
              {filteredMembers.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <UserX className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No results found</h3>
                  <p className="text-muted-foreground mt-2">No members match your filter. Try a different term.</p>
                </div>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-primary hover:bg-primary">
                          <TableHead className="w-16 text-base font-semibold">S.No.</TableHead>
                          <TableHead className="text-base font-semibold">Member ID</TableHead>
                          <TableHead className="text-base font-semibold">Member Name</TableHead>
                          <TableHead className="text-base font-semibold">Joined Date</TableHead>
                          <TableHead className="text-base font-semibold">Termination Date</TableHead>
                          <TableHead className="text-base font-semibold">Termination Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMembers.map((member, index) => (
                          <TableRow key={member.id}>
                            <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                            <TableCell>{member.rotaryId || "-"}</TableCell>
                            <TableCell className="font-medium">{member.memberName}</TableCell>
                            <TableCell>{formatDate(member.joinedDate)}</TableCell>
                            <TableCell>{formatDate(member.terminationDate)}</TableCell>
                            <TableCell className="max-w-[300px] truncate">{member.terminationReason || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          );
        })()}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}
