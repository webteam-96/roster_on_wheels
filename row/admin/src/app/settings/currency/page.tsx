"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * SuperAdmin › Settings › Currency.
 * --------------------------------------------------------------------------
 * Sets each district's default currency (one the instance offers), pre-selected on the
 * currency dropdown when a club in that district adds a project, and overridable
 * per-project either way. A district without one uses the instance's default currency.
 * Dashboards show a district's totals in this currency, converted at the day's rate;
 * stored amounts are never changed.
 */

import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Globe, Loader2, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import { PageHeader, SkeletonRows } from "@/components/row/AppKit";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ProtectedRoute from "@/components/ProtectedRoute";
import Pagination from "@/components/Pagination";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrencyRates, getDistricts, setDistrictCurrenciesFromCountry, updateDistrictDefaultCurrency, type CurrencyRateInfo } from "@/services/api";
import { currencyOptions } from "@/lib/currency";
import { DistrictListItem } from "@/types/district";

import { appFormat, defaultCurrency } from "@/lib/appFormat";
const PAGE_SIZE = 25;

export default function CurrencySettingsPage() {
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<DistrictListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [rates, setRates] = useState<CurrencyRateInfo | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => { getCurrencyRates().then(setRates).catch(() => setRates(null)); }, []);

  const base = defaultCurrency();
  const options = useMemo(() => currencyOptions(), []);
  const currencyOf = (d: DistrictListItem) => (d.defaultCurrency || base).toUpperCase();
  // Still on the platform default although the country has its own currency.
  const toFix = rows.filter((d) => d.countryCurrency && currencyOf(d) === base && d.countryCurrency !== base);

  const applyFromCountry = async () => {
    setIsApplying(true);
    try {
      const { changed } = await setDistrictCurrenciesFromCountry();
      setSuccessMessage(`${changed} districts now use their country's currency.`);
      await load();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not set the currencies. Please try again.");
    } finally {
      setIsApplying(false);
      setIsConfirmOpen(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDistricts(1, 9999, search.trim() || undefined, 1);
      setRows((res.items || []).sort((a: any, b: any) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
    } catch {
      setErrorMessage("Could not load districts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleChange = async (district: DistrictListItem, currency: string) => {
    setRows((prev) => prev.map((r) => (r.id === district.id ? { ...r, defaultCurrency: currency } : r)));
    setSavingId(district.id);
    try {
      await updateDistrictDefaultCurrency(district.id, currency);
      setSavedId(district.id);
      setTimeout(() => setSavedId((id) => (id === district.id ? null : id)), 1500);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save currency.");
      // Revert on failure
      setRows((prev) => prev.map((r) => (r.id === district.id ? { ...r, defaultCurrency: district.defaultCurrency } : r)));
    } finally {
      setSavingId(null);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title="Currency" description={<>Set each district&apos;s default currency for project-add forms</>} back="/settings" />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search district number…" className="pl-8" />
          </div>
          {!search && toFix.length > 0 && (
            <Button onClick={() => setIsConfirmOpen(true)} disabled={isApplying}>
              <Globe className="mr-2 h-4 w-4" />Use country currency ({toFix.length})
            </Button>
          )}
          {rates && (
            <p className="ml-auto text-[13px] text-muted-foreground">
              Exchange rates of {appFormat().date(rates.asOf)}{rates.isLive ? "" : " (live rates are not reachable)"}
            </p>
          )}
        </div>

        {loading ? (
          <SkeletonRows rows={8} />
        ) : (
          <Card className="overflow-x-auto">
            <Table className="w-full min-w-[640px] md:min-w-full text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 text-left">District</TableHead>
                  <TableHead className="px-4 text-left">Zone</TableHead>
                  <TableHead className="px-4 text-left">Country</TableHead>
                  <TableHead className="px-4 text-left w-72">Default Currency</TableHead>
                  <TableHead className="px-4 text-right whitespace-nowrap">1 {base} is</TableHead>
                  <TableHead className="px-4 w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((d) => (
                  <TableRow key={d.id} className="hover:bg-blue-50/40">
                    <TableCell className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">District {d.districtNumber}</TableCell>
                    <TableCell className="px-4 py-2 text-slate-600 whitespace-nowrap">{d.zoneName || "–"}</TableCell>
                    <TableCell className="px-4 py-2 text-slate-600 whitespace-nowrap">{d.country || "–"}</TableCell>
                    <TableCell className="px-4 py-2">
                      <NativeSelect
                        aria-label={`Currency of district ${d.districtNumber}`}
                        value={currencyOf(d)}
                        onChange={(e) => handleChange(d, e.target.value)}
                        disabled={savingId === d.id}
                        className="disabled:opacity-60"
                      >
                        {/* A stored currency the list does not offer is still shown as what it is. */}
                        {!options.some((c) => c.code === currencyOf(d)) && <option value={currencyOf(d)}>{currencyOf(d)}</option>}
                        {options.map((c) => (
                          <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                      </NativeSelect>
                      {d.countryCurrency && d.countryCurrency !== currencyOf(d) && (
                        <p className="mt-1 text-xs text-muted-foreground">{d.country} uses {d.countryCurrency}</p>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">
                      {rates?.rates[currencyOf(d)] ? `${(1 / rates.rates[currencyOf(d)]).toLocaleString(appFormat().locale, { maximumSignificantDigits: 6 })} ${currencyOf(d)}` : "–"}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right">
                      {savingId === d.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                      {savedId === d.id && <Check className="h-4 w-4 text-emerald-600" />}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No districts found.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            {rows.length > PAGE_SIZE && (
              <div className="border-t p-3">
                <Pagination page={page} totalPages={Math.ceil(rows.length / PAGE_SIZE)} totalCount={rows.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
              </div>
            )}
          </Card>
        )}

        <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Set {toFix.length} districts to their country&apos;s currency?</AlertDialogTitle>
              <AlertDialogDescription>
                Only districts still on {base} change; a currency someone chose stays. Stored amounts stay as they are.
                Totals of these districts are then shown in their own currency, converted at the day&apos;s rate.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isApplying}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={isApplying} onClick={(e) => { e.preventDefault(); applyFromCountry(); }}>
                {isApplying ? "Saving…" : "Set currencies"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <SuccessAlert open={!!successMessage} title="Saved" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
