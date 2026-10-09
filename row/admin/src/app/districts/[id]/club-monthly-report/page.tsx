"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDistrictReportYears, getDistrictReportMonths, getDistrict } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BarChart3, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function DistrictClubMonthlyReportPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();

  const [districtName, setDistrictName] = useState("");
  const [years, setYears] = useState<any[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [months, setMonths] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [navigatingMonth, setNavigatingMonth] = useState<number | null>(null);

  useEffect(() => {
    async function fetchInitial() {
      setLoading(true);
      try {
        const [d, yrs] = await Promise.all([getDistrict(districtId), getDistrictReportYears(districtId)]);
        setDistrictName(`District ${d.districtNumber}`);
        setYears(yrs);
        if (yrs.length > 0) {
          const cur = yrs.find((y: any) => y.isCurrent) || yrs[0];
          setSelectedYearId(String(cur.id));
        }
      } catch {}
      finally { setLoading(false); }
    }
    fetchInitial();
  }, [districtId]);

  const fetchMonths = useCallback(async (yearId: number) => {
    setLoadingMonths(true);
    try {
      const data = await getDistrictReportMonths(districtId, yearId);
      setMonths(Array.isArray(data) ? data : []);
    } catch { setMonths([]); }
    finally { setLoadingMonths(false); }
  }, [districtId]);

  useEffect(() => {
    if (selectedYearId) fetchMonths(Number(selectedYearId));
    else setMonths([]);
  }, [selectedYearId, fetchMonths]);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/districts/${districtId}/dashboard`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {districtName ? `${districtName} - Club Monthly Report` : "Club Monthly Report"}
              </h2>
              <p className="text-muted-foreground text-base">Monthly report submission status by clubs</p>
            </div>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>}

        {!loading && years.length > 0 && (
          <div className="flex items-center gap-4">
            <Select value={selectedYearId} onValueChange={setSelectedYearId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Select year" /></SelectTrigger>
              <SelectContent>
                {years.map((y: any) => (
                  <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loadingMonths && <div className="flex items-center justify-center py-12"><RotaryLoader size="lg" /></div>}

        {!loading && !loadingMonths && months.length === 0 && selectedYearId && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No months available</h3>
            <p className="text-muted-foreground mt-2">No monthly report data for this year.</p>
          </div>
        )}

        {!loading && !loadingMonths && months.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {months.map((m: any) => {
              const pct = m.totalClubs > 0 ? Math.round((m.submittedCount / m.totalClubs) * 100) : 0;
              return (
                <Card
                  key={m.month}
                  className={`cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all ${navigatingMonth === m.month ? "opacity-60 pointer-events-none" : ""}`}
                  onClick={() => {
                    setNavigatingMonth(m.month);
                    router.push(`/districts/${districtId}/club-monthly-report/${selectedYearId}/${m.month}`);
                  }}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      {navigatingMonth === m.month ? <RotaryLoader size="sm" /> : <BarChart3 className="h-6 w-6 text-primary" />}
                      <Badge variant={pct === 100 ? "default" : pct >= 50 ? "secondary" : "destructive"} className="text-xs">
                        {pct}%
                      </Badge>
                    </div>
                    <p className="font-semibold text-base">{m.monthName}</p>
                    <div className="mt-3 space-y-1.5">
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          <span>{m.submittedCount} Submitted</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          <span>{m.notSubmittedCount} Pending</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground text-center">Total: {m.totalClubs} Clubs</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
