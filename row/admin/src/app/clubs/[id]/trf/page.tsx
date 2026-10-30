"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TrfFund, TrfContribution } from "@/types/trfContribution";
import { ReportYear } from "@/types/clubMonthlyReport";
import {
  getClub,
  getTrfYears,
  getTrfFunds,
  getTrfContributions,
  createTrfContribution,
  updateTrfContribution,
  deleteTrfContribution,
} from "@/services/api";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Calendar,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Pagination from "@/components/Pagination";
import SearchBox from "@/components/SearchBox";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
function TrfIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="20" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path
        d="M24 12v24M18 18l6-6 6 6"
        className="stroke-primary"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="30" r="6" className="stroke-primary" strokeWidth="2" fill="none" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        className="fill-primary"
        fontSize="8"
        fontWeight="bold"
      >
        $
      </text>
    </svg>
  );
}

interface TrfFormData {
  trfDate: string;
  donorName: string;
  amountUSD: number;
  fundId: number;
  otherFundName: string;
}

const emptyForm: TrfFormData = {
  trfDate: "",
  donorName: "",
  amountUSD: 0,
  fundId: 0,
  otherFundName: "",
};

export default function TrfContributionPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const fromParam = searchParams.get("from");
  const yearIdParam = searchParams.get("yearId");
  const monthParam = searchParams.get("month");
  // True only when CMR drove us here AND we have both year + month context.
  const isFromCmrMonth = fromParam === "cmr" && !!yearIdParam && !!monthParam;

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [funds, setFunds] = useState<TrfFund[]>([]);
  const [contributions, setContributions] = useState<TrfContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Pagination — client-side, since data is already year-scoped (typically small).
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  // Dialog state
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TrfFormData>({ ...emptyForm });

  const isFrozenYear = fromParam === "cmr" && !!yearIdParam;

  // Determine back URL. When CMR sent us a month too, the back/redirect target is the
  // specific month wizard with ?step=trf so the wizard opens on the TRF tab (not Meetings).
  const backUrl = isFromCmrMonth
    ? `/clubs/${clubId}/club-monthly-report/${yearIdParam}/${monthParam}?step=trf`
    : fromParam === "cmr"
      ? `/clubs/${clubId}/club-monthly-report`
      : `/clubs/${clubId}/dashboard`;

  // Lock the TRF date to the CMR month when isFromCmrMonth. yearLabel is "YYYY-YY"; calendar
  // year for the locked month = startYear when month >= 7 (Jul-Dec), else startYear + 1.
  const lockedMonth = isFromCmrMonth ? Number(monthParam) : null;
  const yearObj = years.find((y) => y.id === Number(yearIdParam));
  const lockedCalendarYear = (() => {
    if (!lockedMonth || !yearObj?.yearLabel) return null;
    const startYear = Number(yearObj.yearLabel.split("-")[0]);
    if (!Number.isFinite(startYear)) return null;
    return lockedMonth >= 7 ? startYear : startYear + 1;
  })();
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const lockedMinIso =
    lockedMonth && lockedCalendarYear
      ? `${lockedCalendarYear}-${pad2(lockedMonth)}-01T00:00`
      : undefined;
  const lockedMaxIso = (() => {
    if (!lockedMonth || !lockedCalendarYear) return undefined;
    // Last day of the locked month: day 0 of (month+1) in JS Date.
    const lastDay = new Date(lockedCalendarYear, lockedMonth, 0).getDate();
    return `${lockedCalendarYear}-${pad2(lockedMonth)}-${pad2(lastDay)}T23:59`;
  })();

  // Load initial data
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [club, yearsData, fundsData] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
          getTrfFunds(clubId),
        ]);
        setClubName(club.clubName);
        setYears(yearsData);
        setFunds(fundsData.filter((f) => f.isActive));

        if (yearIdParam && yearsData.some((y) => y.id === Number(yearIdParam))) {
          setSelectedYearId(Number(yearIdParam));
        } else {
          const currentYear = yearsData.find((y) => y.isCurrent);
          if (currentYear) {
            setSelectedYearId(currentYear.id);
          } else if (yearsData.length > 0) {
            setSelectedYearId(yearsData[0].id);
          }
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(
          respData?.message ||
            respData?.detail ||
            respData?.title ||
            (err instanceof Error ? err.message : "Failed to load data.")
        );
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, yearIdParam, cmrOn]);

  // Load contributions when year changes
  const loadContributions = useCallback(async () => {
    if (!selectedYearId) return;
    setTableLoading(true);
    try {
      const data = await getTrfContributions(clubId, selectedYearId);
      setContributions(data);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message ||
          (err instanceof Error ? err.message : "Failed to load contributions")
      );
    } finally {
      setTableLoading(false);
    }
  }, [clubId, selectedYearId]);

  useEffect(() => {
    if (selectedYearId) {
      loadContributions();
    }
  }, [selectedYearId, loadContributions]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(appLocale(), {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const getSelectedFund = (fundId: number) => funds.find((f) => f.id === fundId);

  const openAddDialog = () => {
    setEditingId(null);
    // From CMR: prefill with the locked month's first day at midnight so the date input opens
    // already inside the allowed range; user can only nudge the day within Min/Max bounds.
    setForm({ ...emptyForm, trfDate: lockedMinIso || "" });
    setDialogOpen(true);
  };

  const openEditDialog = (entry: TrfContribution) => {
    setEditingId(entry.id);
    setForm({
      trfDate: entry.trfDate ? entry.trfDate.slice(0, 16) : "",
      donorName: entry.donorName,
      amountUSD: entry.amountUSD,
      fundId: entry.fundId,
      otherFundName: entry.otherFundName || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.trfDate) {
      setErrorMessage("Date & Time is required");
      return;
    }
    // Defensive bounds check — browser min/max can be bypassed by paste / direct input.
    if (isFromCmrMonth && lockedMinIso && lockedMaxIso) {
      if (form.trfDate < lockedMinIso || form.trfDate > lockedMaxIso) {
        setErrorMessage("Date must be within the monthly report's month.");
        return;
      }
    }
    if (!form.donorName.trim()) {
      setErrorMessage("Name is required");
      return;
    }
    if (form.donorName.length > 200) {
      setErrorMessage("Name must be 200 characters or less");
      return;
    }
    if (form.amountUSD < 0) {
      setErrorMessage("Amount must be 0 or greater");
      return;
    }
    if (!form.fundId) {
      setErrorMessage("Fund Type is required");
      return;
    }

    const selectedFund = getSelectedFund(form.fundId);
    if (
      selectedFund?.fundName === "Others" &&
      !form.otherFundName?.trim()
    ) {
      setErrorMessage("Please specify the fund name");
      return;
    }

    setSaving(true);
    try {
      const otherName =
        selectedFund?.fundName === "Others" ? form.otherFundName : null;

      if (editingId) {
        await updateTrfContribution(clubId, editingId, {
          trfDate: form.trfDate,
          donorName: form.donorName.trim(),
          amountUSD: form.amountUSD,
          fundId: form.fundId,
          otherFundName: otherName,
        });
        setSuccessMessage("Contribution updated successfully");
      } else {
        if (!selectedYearId) return;
        await createTrfContribution(clubId, {
          yearId: selectedYearId,
          trfDate: form.trfDate,
          donorName: form.donorName.trim(),
          amountUSD: form.amountUSD,
          fundId: form.fundId,
          otherFundName: otherName,
        });
        setSuccessMessage("Contribution added successfully");
      }
      setDialogOpen(false);
      // From CMR month: send the user back to the same CMR wizard step so they don't have
      // to navigate manually. Normal Club → TRF flow stays on the TRF page as before.
      if (isFromCmrMonth) {
        router.push(backUrl);
        return;
      }
      await loadContributions();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message ||
          (err instanceof Error ? err.message : "Failed to save contribution")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (trfId: number) => {
    if (!confirm("Are you sure you want to delete this TRF contribution?"))
      return;
    try {
      setDeletingId(trfId);
      await deleteTrfContribution(clubId, trfId);
      setContributions((prev) => prev.filter((c) => c.id !== trfId));
      setSuccessMessage("Contribution deleted successfully");
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message ||
          (err instanceof Error ? err.message : "Failed to delete contribution")
      );
    } finally {
      setDeletingId(null);
    }
  };

  const filteredContributions = contributions.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (entry.donorName || "").toLowerCase().includes(q) ||
      (entry.fundType || "").toLowerCase().includes(q) ||
      String(entry.amountUSD).includes(q) ||
      (entry.trfDate ? formatDate(entry.trfDate).toLowerCase().includes(q) : false)
    );
  });

  const totalAmount = contributions.reduce((sum, c) => sum + c.amountUSD, 0);

  // Reset to page 1 whenever the filtered set changes (search edit / year change).
  // Without this, after filtering you might land on a non-existent page.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedYearId]);

  const totalPages = Math.max(1, Math.ceil(filteredContributions.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paginatedContributions = filteredContributions.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={backUrl}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - TRF Contributions` : "TRF Contributions"}
              </h2>
              <p className="text-muted-foreground text-base">
                The Rotary Foundation contributions
              </p>
            </div>
          </div>

          {/* Year filter */}
          {!loading && years.length > 0 && (
            <div className="w-full sm:w-52">
              <Select
                value={selectedYearId?.toString() || ""}
                onValueChange={(v) => setSelectedYearId(Number(v))}
                disabled={isFrozenYear}
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
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Content */}
        {!loading && selectedYearId && (
          <div className="space-y-4">
            {/* Add button */}
            <div className="flex justify-end">
              <Button onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-1" />
                Add Contribution
              </Button>
            </div>

            {contributions.length > 0 && !tableLoading && (
              <SearchBox
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by donor name, fund type, amount..."
              />
            )}

            {!tableLoading && filteredContributions.length === 0 && contributions.length > 0 && searchQuery && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TrfIcon />
                <h3 className="text-lg font-semibold mt-3">No results found</h3>
                <p className="text-muted-foreground mt-2">No contributions match your search &quot;{searchQuery}&quot;.</p>
              </div>
            )}

            {tableLoading ? (
              <div className="flex items-center justify-center py-12">
                <RotaryLoader />
              </div>
            ) : contributions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <TrfIcon />
                <p className="text-lg font-medium mt-3">No TRF contributions</p>
                <p className="text-sm mt-1">
                  Click &quot;Add Contribution&quot; to add one
                </p>
              </div>
            ) : filteredContributions.length === 0 ? null : (
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Sr.No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                      <TableHead>Fund Type</TableHead>
                      <TableHead className="w-24 text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedContributions.map((entry, index) => (
                      <TableRow key={entry.id}>
                        <TableCell>{pageStart + index + 1}</TableCell>
                        <TableCell>{formatDate(entry.trfDate)}</TableCell>
                        <TableCell className="font-medium">
                          {entry.donorName}
                        </TableCell>
                        <TableCell className="text-right">
                          ${entry.amountUSD.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {entry.fundType === "Others"
                            ? entry.otherFundName || "Others"
                            : entry.fundType}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(entry)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleDelete(entry.id)}
                              disabled={deletingId === entry.id}
                            >
                              {deletingId === entry.id ? (
                                <RotaryLoader size="sm" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="px-4 py-3 text-right font-semibold text-sm border-t">
                  Total: ${totalAmount.toLocaleString()} USD
                </div>
                <div className="px-4 py-3 border-t">
                  <Pagination
                    page={safePage}
                    totalPages={totalPages}
                    totalCount={filteredContributions.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setCurrentPage}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Contribution" : "Add Contribution"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="trfDate">
                  Date & Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="trfDate"
                  type="datetime-local"
                  value={form.trfDate}
                  min={lockedMinIso}
                  max={lockedMaxIso}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, trfDate: e.target.value }))
                  }
                />
                {isFromCmrMonth && lockedCalendarYear && lockedMonth && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Locked to {[
                      "", "January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December",
                    ][lockedMonth]} {lockedCalendarYear} (from monthly report)
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="donorName">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="donorName"
                  type="text"
                  maxLength={200}
                  value={form.donorName}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, donorName: e.target.value }))
                  }
                  placeholder="Enter donor name"
                />
              </div>
              <div>
                <Label htmlFor="amountUSD">
                  Amount USD <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="amountUSD"
                  type="number"
                  min={0}
                  value={form.amountUSD}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      amountUSD: parseFloat(e.target.value) || 0,
                    }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label htmlFor="fundType">
                  Fund Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.fundId ? form.fundId.toString() : ""}
                  onValueChange={(value) => {
                    const fId = Number(value);
                    const fund = getSelectedFund(fId);
                    setForm((prev) => ({
                      ...prev,
                      fundId: fId,
                      otherFundName:
                        fund?.fundName !== "Others" ? "" : prev.otherFundName,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select fund type" />
                  </SelectTrigger>
                  <SelectContent>
                    {funds.map((f) => (
                      <SelectItem key={f.id} value={f.id.toString()}>
                        {f.fundName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {getSelectedFund(form.fundId)?.fundName === "Others" && (
                <div>
                  <Label htmlFor="otherFundName">
                    Fund Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="otherFundName"
                    type="text"
                    value={form.otherFundName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        otherFundName: e.target.value,
                      }))
                    }
                    placeholder="Enter fund name"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <RotaryLoader size="sm" />
                ) : editingId ? (
                  "Update"
                ) : (
                  "Add"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Alerts */}
        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
        <SuccessAlert
          open={!!successMessage}
          title="Success"
          description={successMessage || ""}
          onOk={() => setSuccessMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
