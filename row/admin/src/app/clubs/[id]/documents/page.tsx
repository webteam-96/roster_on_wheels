"use client";
import { ClearButton } from "@/components/ui/text-buttons";

import PublishStatusBadge from "@/components/PublishStatusBadge";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { DocumentListItem } from "@/types/document";
import {
  getClub,
  getDocuments,
  deleteDocument,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { clubYearRights, canEditYearless } from "@/lib/adminYears";
import { useRotaryYears } from "@/hooks/useRotaryYears";
import ViewOnlyBadge from "@/components/ViewOnlyBadge";
import { useCurrentRotaryYear } from "@/hooks/useCurrentRotaryYear";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Search, X, Plus, Pencil, Trash2, Eye, MoreHorizontal, FolderOpen, AlertTriangle, Download } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Published", label: "Published" },
  { value: "Expired", label: "Expired" },
  { value: "Unpublished", label: "Unpublished" },
];


function AccessTypeBadge({ accessType }: { accessType: string }) {
  const isViewOnly = accessType === "view_only";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isViewOnly ? "bg-[#FFC65C] text-orange-700" : "bg-green-100 text-green-700"}`}>
      {isViewOnly ? "View Only" : "Downloadable"}
    </span>
  );
}

export default function DocumentsPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const { isSuperAdmin, isAdmin, user } = useAuth();

  const [clubName, setClubName] = useState("");
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 20;

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentListItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // This module carries no Rotary year, so editing it needs CURRENT-year rights —
  // the same rule AdminYearGuard.ClubYearlessAsync applies on the server.
  const currentYearId = useCurrentRotaryYear();
  const { years: ywarYears } = useRotaryYears();
  const yearRights = useMemo(() => clubYearRights(user?.scopedRoles, clubId), [user?.scopedRoles, clubId]);
  const isClubAdmin = isSuperAdmin || isAdmin;
  const canManage = isClubAdmin && canEditYearless(yearRights, currentYearId, isSuperAdmin);
  // YWAR-BADGE-YEARLESS — name the CURRENT year, not the years held.
  // This data is not filed by Rotary year, so "you can make changes in
  // 2025-26" is untrue: those years cannot help here. See ViewOnlyBadge.
  const ywarCurrentYearLabel =
    ywarYears.find((y) => y.id === currentYearId)?.yearLabel ?? "";

  // ⚠️ View must NOT depend on canManage — see the comment in projects/page.tsx.
  const canView = isClubAdmin;
  useEffect(() => {
    async function init() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to initialize.");
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDocuments(
        clubId, page, pageSize,
        statusFilter !== "all" ? statusFilter : undefined,
        search || undefined
      );
      setDocuments(result.items);
      setTotalCount(result.totalCount);
    } catch {
      setDocuments([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [clubId, page, search, statusFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleSearch = () => { setPage(1); setSearch(searchInput); };
  const clearSearch = () => { setSearchInput(""); setSearch(""); setPage(1); };
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleAddClick = () => {
    router.push(`/clubs/${clubId}/documents/add`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDocument(clubId, deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Document deleted successfully.");
      fetchDocuments();
    } catch {
      setDeleteTarget(null);
      setErrorMessage("Failed to delete document.");
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const filteredDocuments = documents.filter((doc) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (doc.title || "").toLowerCase().includes(q) ||
      (doc.filePath || "").toLowerCase().includes(q) ||
      (doc.status || "").toLowerCase().includes(q)
    );
  });

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Documents` : "Documents"}
          description="Manage documents"
          back={`/clubs/${clubId}/dashboard`}
          actions={canManage && (
            <Button onClick={handleAddClick}>
              <Plus className="mr-2 h-4 w-4" />Add Document
            </Button>
          )}
        />

        {isClubAdmin && !canManage && (
          <ViewOnlyBadge currentYearOnly={ywarCurrentYearLabel} className="mb-4" />
        )}

        {/* Status filter + Search */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-44">
            <Select
              value={statusFilter}
              onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9"
              />
              {searchInput && (
                <ClearButton onClick={clearSearch} aria-label="Clear search" />
              )}
            </div>
            <Button onClick={handleSearch} size="sm">Search</Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && documents.length > 0 && (
          <SearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by title, file name..."
          />
        )}

        {!loading && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No documents found</h3>
            <p className="text-muted-foreground mt-2">
              {search ? "No documents match your search." : canManage ? `Click "Add Document" to create one.` : "No documents for this year."}
            </p>
          </div>
        )}

        {!loading && filteredDocuments.length === 0 && documents.length > 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No results found</h3>
            <p className="text-muted-foreground mt-2">No documents match your search &quot;{searchQuery}&quot;.</p>
          </div>
        )}

        {!loading && filteredDocuments.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">S.No.</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-center">Access Type</TableHead>
                    <TableHead>Publish Date & Time</TableHead>
                    <TableHead>Expiry Date & Time</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-12 text-center">Download</TableHead>
                    {canView && (
                      <TableHead className="w-12"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map((doc, index) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{(page - 1) * pageSize + index + 1}</TableCell>
                      <TableCell>
                        <p
                          className="font-medium cursor-pointer hover:text-primary"
                          onClick={() => router.push(`/clubs/${clubId}/documents/${doc.id}`)}
                        >
                          {doc.title}
                        </p>
                      </TableCell>
                      <TableCell className="text-center">
                        <AccessTypeBadge accessType={doc.accessType} />
                      </TableCell>
                      <TableCell>{formatDateTime(doc.publishDateTime)}</TableCell>
                      <TableCell>{formatDateTime(doc.expiryDateTime)}</TableCell>
                      <TableCell className="text-center">
                        <PublishStatusBadge status={doc.status} />
                      </TableCell>
                      <TableCell className="text-center">
                        {doc.filePath && (
                          doc.accessType === "downloadable" ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="row-btn-sm"
                              aria-label={`Download ${doc.originalFileName || doc.title}`}
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${API_URL}${doc.filePath}`);
                                  const blob = await res.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = doc.originalFileName || "document";
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                } catch { window.open(`${API_URL}${doc.filePath}`, "_blank"); }
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button asChild variant="ghost" size="icon" className="row-btn-sm">
                              <a href={`${API_URL}${doc.filePath}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${doc.originalFileName || doc.title}`}>
                                <Download className="h-4 w-4" />
                              </a>
                            </Button>
                          )
                        )}
                      </TableCell>
                      {canView && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="row-btn-sm" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/documents/${doc.id}`)}>
                                <Eye className="mr-2 h-4 w-4" />View
                              </DropdownMenuItem>
                              {doc.status !== "Expired" && canManage && (
                                <DropdownMenuItem onClick={() => router.push(`/clubs/${clubId}/documents/${doc.id}/edit`)}>
                                  <Pencil className="mr-2 h-4 w-4" />Edit
                                </DropdownMenuItem>
                              )}
                              {canManage && (
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(doc)}>
                                  <Trash2 className="mr-2 h-4 w-4" />Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        )}

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Document"
          description={
            <>Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.title}</span>? This action cannot be undone.</>
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
