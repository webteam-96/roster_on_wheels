"use client";

import { useState, useCallback, useEffect } from "react";
import { RotaryYear } from "@/types/rotaryYear";
import { getRotaryYears, addNextRotaryYear } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Calendar, Plus } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

export default function RotaryYearsPage() {
  const { isSuperAdmin } = useAuth();

  const [years, setYears] = useState<RotaryYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleAddNext = async () => {
    setConfirmOpen(false);
    setAdding(true);
    try {
      const result = await addNextRotaryYear();
      setSuccessMessage(result.message || `Rotary year ${result.yearLabel} added.`);
      await fetchYears();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to add next rotary year.");
    } finally {
      setAdding(false);
    }
  };

  const fetchYears = useCallback(async () => {
    setLoading(true);
    try {
      const yrs = await getRotaryYears();
      setYears(yrs);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load rotary years.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchYears(); }, [fetchYears]);

  const filteredYears = years.filter((yr) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      yr.yearLabel.toLowerCase().includes(q) ||
      yr.startDate.toLowerCase().includes(q) ||
      yr.endDate.toLowerCase().includes(q) ||
      (yr.isCurrent ? "current" : "").includes(q)
    );
  });

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Rotary Years</h2>
              <p className="text-muted-foreground text-base">Auto-generated from 1980 to current year</p>
            </div>
          </div>
          <Button onClick={() => setConfirmOpen(true)} disabled={adding}>
            <Plus className="mr-2 h-4 w-4" />
            {adding ? "Adding..." : "Add Next Year"}
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {!loading && years.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No rotary years found</h3>
          </div>
        )}

        {!loading && years.length > 0 && (
          <>
            <SearchBox
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search rotary years..."
            />
            {filteredYears.length === 0 && searchQuery.trim() !== "" ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No results found for &quot;{searchQuery}&quot;</p>
            ) : (
            <>
            {/* Mobile card view */}
            <div className="block sm:hidden space-y-2">
              {filteredYears.map((yr) => (
                <div key={yr.id} className="flex items-center justify-between border rounded-md p-3">
                  <div>
                    <p className="font-medium">{yr.yearLabel}</p>
                    <p className="text-xs text-muted-foreground">{yr.startDate} — {yr.endDate}</p>
                  </div>
                  {yr.isCurrent && <Badge variant="default">Current</Badge>}
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-12 text-primary-foreground">#</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Year Label</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">Start Date</TableHead>
                    <TableHead className="text-primary-foreground text-base font-semibold">End Date</TableHead>
                    <TableHead className="w-24 text-primary-foreground text-base font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredYears.map((yr, i) => (
                    <TableRow key={yr.id} className="hover:bg-primary/5 transition-colors">
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-medium">{yr.yearLabel}</TableCell>
                      <TableCell>{yr.startDate}</TableCell>
                      <TableCell>{yr.endDate}</TableCell>
                      <TableCell>
                        {yr.isCurrent ? (
                          <Badge variant="default">Current</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}

        <AlertModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          icon={Calendar}
          iconClassName="text-primary"
          title="Add Next Rotary Year"
          description="This will create the next rotary year after the latest one. Do you want to continue?"
          confirmLabel="Yes, Add"
          onConfirm={handleAddNext}
          cancelLabel="Cancel"
          onCancel={() => setConfirmOpen(false)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
