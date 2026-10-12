"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getOcvReport, getMonthlyReportYears, getClub, downloadOcvDocumentBlob } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import { OCV_LIVE_DOCUMENTS_TITLE, ocvLiveDocumentsNote, fetchOcvLiveDocumentTables } from "@/lib/ocvLiveDocuments";
import { OcvReportItem } from "@/types/ocvGov";
import { ReportYear } from "@/types/clubMonthlyReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Calendar, Download, Eye, FileSpreadsheet } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function OcvReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const initialYearId = searchParams.get("yearId") ? Number(searchParams.get("yearId")) : null;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(initialYearId);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [reportItems, setReportItems] = useState<OcvReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  // The Excel now fetches the live module snapshots before writing the workbook, so it is
  // no longer instantaneous — gate the button while that request is in flight.
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchYears() {
      try {
        const [club, data] = await Promise.all([getClub(clubId), getMonthlyReportYears(clubId)]);
        setClubName(club.clubName);
        setYears(data);
        if (!selectedYearId) {
          const currentYear = data.find((y) => y.isCurrent);
          setSelectedYearId(currentYear ? currentYear.id : data.length > 0 ? data[0].id : null);
        }
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load years.");
      } finally {
        setLoading(false);
      }
    }
    fetchYears();
  }, [clubId]); // eslint-disable-line

  useEffect(() => {
    if (!selectedYearId) return;
    async function fetchReport() {
      setLoadingReport(true);
      try {
        const data = await getOcvReport(clubId, selectedYearId!, statusFilter === "all" ? undefined : statusFilter);
        setReportItems(data);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || "Failed to load report.");
        setReportItems([]);
      } finally {
        setLoadingReport(false);
      }
    }
    fetchReport();
  }, [clubId, selectedYearId, statusFilter]);

  const handleView = (filePath: string) => {
    window.open(`${API_BASE_URL}${filePath}`, "_blank");
  };

  const handleDownload = async (documentId: number | null, filePath: string, originalFileName: string) => {
    // Use the controller download endpoint (auth + CORS handled, Content-Disposition: attachment).
    // Falls back to opening the static URL in a new tab if the API call ever fails.
    try {
      if (documentId == null) throw new Error("documentId missing");
      const blob = await downloadOcvDocumentBlob(clubId, documentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = originalFileName || "document";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_BASE_URL}${filePath}`, "_blank", "noopener,noreferrer");
    }
  };

  // Get unique categories for filter
  const categories = [...new Set(reportItems.map(i => i.categoryName))];

  // Filter items
  const filteredItems = categoryFilter === "all"
    ? reportItems
    : reportItems.filter(i => i.categoryName === categoryFilter);

  // Group by category
  const groupedItems: { categoryName: string; items: OcvReportItem[] }[] = [];
  const categoryMap = new Map<string, OcvReportItem[]>();
  for (const item of filteredItems) {
    const existing = categoryMap.get(item.categoryName);
    if (existing) existing.push(item);
    else categoryMap.set(item.categoryName, [item]);
  }
  for (const [categoryName, items] of Array.from(categoryMap)) {
    groupedItems.push({ categoryName, items });
  }

  const yearLabel = years.find(y => y.id === selectedYearId)?.yearLabel || "";

  // Excel export — async because the Live Documents section is fetched live.
  const handleExcelDownload = async () => {
    setDownloadingExcel(true);
    try {
      await buildExcel();
    } finally {
      setDownloadingExcel(false);
    }
  };

  const buildExcel = async () => {
    const rows = filteredItems.map((item, idx) => ({
      sno: idx + 1,
      module: item.categoryName,
      documentType: item.typeName,
      status: item.isUploaded ? "Uploaded" : "Not Uploaded",
      fileName: item.originalFileName || "—",
      amount: (item as any).amount || "—",
      paidOn: (item as any).paidOn || "—",
      uploadDate: (item as any).createdDate || "—",
      viewLink: item.isUploaded && item.filePath ? `${API_BASE_URL}${item.filePath}` : "",
    }));
    // Second section: Live Documents — the SAME module snapshots the Word report renders,
    // fetched from the same backend list so the two documents can never disagree. They can
    // never appear in the uploaded-document checklist above.
    const liveTables = await fetchOcvLiveDocumentTables(clubId, selectedYearId);
    exportToCSV(rows, `OCV_Report_${clubName}`, [
      { key: "sno", label: "S.No", width: 6 },
      { key: "module", label: "Module", width: 22 },
      { key: "documentType", label: "Document Type", width: 30 },
      { key: "status", label: "Status", width: 14 },
      { key: "fileName", label: "File Name", width: 30 },
      { key: "viewLink", label: "View Document", width: 20, hyperlink: true },
    ], {
      title: `OCV Report — ${clubName}`,
      subtitle: `Rotary Year: ${yearLabel}`,
      extraTable: {
        title: OCV_LIVE_DOCUMENTS_TITLE,
        note: ocvLiveDocumentsNote(),
        sections: liveTables,
      },
    });
  };

  const isLoading = loading || loadingReport;
  let serialCounter = 0;
  const uploadedCount = filteredItems.filter(i => i.isUploaded).length;
  const pendingCount = filteredItems.filter(i => !i.isUploaded).length;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/ocv-gov?yearId=${selectedYearId}`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">OCV Report</h2>
              <p className="text-muted-foreground text-base">{clubName} — Document compliance report</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Year */}
              {years.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Rotary Year</label>
                  <Select value={selectedYearId?.toString() || ""} onValueChange={(v) => setSelectedYearId(Number(v))}>
                    <SelectTrigger><Calendar className="mr-2 h-4 w-4 text-muted-foreground" /><SelectValue placeholder="Select Year" /></SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year.id} value={year.id.toString()}>{year.yearLabel}{year.isCurrent ? " (Current)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Category */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Module</label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger><SelectValue placeholder="All Modules" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    {categories.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Status */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Uploaded</SelectItem>
                    <SelectItem value="no">Not Uploaded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Download All */}
              <div className="flex items-end">
                <Button variant="outline" className="w-full" onClick={handleExcelDownload} disabled={filteredItems.length === 0 || downloadingExcel}>
                  <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />{downloadingExcel ? "Preparing…" : "Download All as Excel"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
        )}

        {/* Empty */}
        {!isLoading && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No report data</h3>
            <p className="text-muted-foreground mt-2">No documents found for the selected filters.</p>
          </div>
        )}

        {/* Report Table grouped by category */}
        {!isLoading && groupedItems.map((group) => (
          <Card key={group.categoryName}>
            <CardContent className="p-0">
              <div className="px-6 py-3 bg-muted/50 border-b flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">{group.categoryName}</h3>
                <Badge variant="secondary">{group.items.filter(i => i.isUploaded).length}/{group.items.length} uploaded</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">S.No</TableHead>
                    <TableHead>Document Type</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>File Name</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((item) => {
                    serialCounter++;
                    return (
                      <TableRow key={`${item.categoryId}-${item.typeId}`}>
                        <TableCell className="font-medium">{serialCounter}</TableCell>
                        <TableCell>{item.typeName}</TableCell>
                        <TableCell className="text-center">
                          {item.isUploaded ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Uploaded</Badge>
                          ) : (
                            <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {item.originalFileName || "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.isUploaded && item.filePath ? (
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleView(item.filePath!)} title="View">
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDownload(item.documentId, item.filePath!, item.originalFileName || "document")} title="Download">
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        {/* Summary */}
        {!isLoading && filteredItems.length > 0 && (
          <div className="flex gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Uploaded</Badge>
              <span className="text-muted-foreground">{uploadedCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">Pending</Badge>
              <span className="text-muted-foreground">{pendingCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">Total: {filteredItems.length} document types</span>
            </div>
          </div>
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
