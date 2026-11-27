"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getMonthlyReportYears, getMonthlyReportMonths, getClub, getMonthlyReportPreview } from "@/services/api";
import { downloadCmrFile } from "@/lib/cmrFileDownload";

const NEW_CMR_FILES = true;   // the new Design B PDF / Word (RIZones 2026-11-13)
import { MonthlyReportListItem, ReportYear } from "@/types/clubMonthlyReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Calendar, CheckCircle2, Clock, Download, FileText, FileSpreadsheet } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { downloadPDF, downloadWord } from "@/utils/reportDownload";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function ClubMonthlyReportPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [months, setMonths] = useState<MonthlyReportListItem[]>([]);
  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadingMonth, setDownloadingMonth] = useState<number | null>(null);

  const handleDownload = async (month: number, format: "pdf" | "word") => {
    if (!selectedYearId) return;
    try {
      setDownloadingMonth(month);
      // NEW Design B PDF / new Word, same as everywhere else (user 2026-11-13). The old calls below are kept, not used.
      if (NEW_CMR_FILES) { await downloadCmrFile(clubId, selectedYearId, month, format); return; }
      const preview = await getMonthlyReportPreview(clubId, selectedYearId, month);
      if (format === "pdf") {
        downloadPDF(preview);
      } else {
        await downloadWord(preview);
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      const msg = respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to download report.");
      setErrorMessage(msg);
    } finally {
      setDownloadingMonth(null);
    }
  };

  // Fetch years on mount
  useEffect(() => {
    async function fetchYears() {
      setLoadingYears(true);
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
        const data = await getMonthlyReportYears(clubId);
        setYears(data);
        // Default to current year, or first year if none is current
        const currentYear = data.find((y) => y.isCurrent);
        if (currentYear) {
          setSelectedYearId(currentYear.id);
        } else if (data.length > 0) {
          setSelectedYearId(data[0].id);
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report years."));
      } finally {
        setLoadingYears(false);
      }
    }
    fetchYears();
  }, [clubId]);

  // Fetch months when year changes
  useEffect(() => {
    if (selectedYearId === null) return;

    async function fetchMonths() {
      setLoadingMonths(true);
      try {
        const data = await getMonthlyReportMonths(clubId, selectedYearId!);
        setMonths(data);
      } catch (err: unknown) {
        setMonths([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load report months."));
      } finally {
        setLoadingMonths(false);
      }
    }
    fetchMonths();
  }, [clubId, selectedYearId]);

  const selectedYear = years.find((y) => y.id === selectedYearId);
  const isLoading = loadingYears || loadingMonths;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Club Monthly Reports` : "Club Monthly Reports"}
          description="View and manage monthly reports"
          back={`/clubs/${clubId}/dashboard`}
          actions={!loadingYears && years.length > 0 && (
            <div className="w-full sm:w-52">
              <Select
                value={selectedYearId?.toString() || ""}
                onValueChange={(v) => setSelectedYearId(Number(v))}
              >
                <SelectTrigger>
                  <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.id} value={year.id.toString()}>
                      {year.yearLabel}
                      {year.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && months.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No months available</h3>
            <p className="text-muted-foreground mt-2">
              {years.length === 0
                ? "No rotary years have been configured yet."
                : "No report months found for the selected year."}
            </p>
          </div>
        )}

        {/* Table */}
        {!isLoading && months.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      S.No.
                    </TableHead>
                    <TableHead>
                      Month
                    </TableHead>
                    <TableHead className="text-center">
                      Status
                    </TableHead>
                    <TableHead className="text-center">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {months.map((item, index) => (
                    <TableRow key={item.month}>
                      <TableCell className="font-medium">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{item.monthName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {item.isCreated ? (
                            <Badge variant="default" className="bg-green-100 text-green-800">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Created
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <Clock className="mr-1 h-3 w-3" />
                              Pending
                            </Badge>
                          )}
                          {item.isUploadedToDistrict && (
                            <Badge variant="default" className="bg-blue-100 text-azure-100 text-blue-800">
                              Uploaded to District
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          {item.isCreated ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  router.push(
                                    `/clubs/${clubId}/club-monthly-report/${selectedYearId}/${item.month}`
                                  )
                                }
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                              {/* Download only after the report is uploaded to district — an
                                  in-progress report is still live/unfrozen, so we don't hand out
                                  a not-yet-submitted copy. */}
                              {item.isUploadedToDistrict && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={downloadingMonth === item.month}
                                    >
                                      {downloadingMonth === item.month ? <RotaryLoader size="sm" /> : <Download className="mr-2 h-4 w-4" />}
                                      {downloadingMonth === item.month ? "Downloading..." : "Download"}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    <DropdownMenuItem onClick={() => handleDownload(item.month, "pdf")}>
                                      <FileText className="mr-2 h-4 w-4 text-red-500" />
                                      Download PDF
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDownload(item.month, "word")}>
                                      <FileSpreadsheet className="mr-2 h-4 w-4 text-blue-500" />
                                      Download Word
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() =>
                                router.push(
                                  `/clubs/${clubId}/club-monthly-report/${selectedYearId}/${item.month}`
                                )
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Create
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
