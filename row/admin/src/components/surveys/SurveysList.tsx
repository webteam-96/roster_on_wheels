"use client";

/** The surveys of a club or district (api/Controllers/SurveysController.cs), shared by both admin dashboards. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { getSurveys } from "@/services/api";
import { STATE_LABEL } from "@/lib/surveys";
import type { Survey, SurveyScope } from "@/types/surveys";

interface Props {
  scope: SurveyScope;
  scopeId: number | null | undefined;
  /** The dashboard's surveys path, e.g. "/club-admin-dashboard/surveys". */
  basePath: string;
}

export default function SurveysList({ scope, scopeId, basePath }: Props) {
  const fmt = useFormat();
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!scopeId) return;
    setSurveys(null);
    setFailed(false);
    getSurveys(scope, scopeId)
      .then(setSurveys)
      .catch((err) => {
        setFailed(true);
        setError(err?.response?.data?.message || "Could not load the surveys.");
      });
  }, [scope, scopeId]);

  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a {scope === "clubs" ? "club" : "district"} first.</p>;

  const audience = scope === "clubs" ? "the club's members (or one sub group)" : "the district's officers (this year's committee and Assistant Governors)";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Surveys and polls</h2>
          <p className="text-base text-muted-foreground">
            Ask {audience} a question. They get a notification and answer in the app. Results come in as they answer,
            with charts and a CSV download.
          </p>
        </div>
        <Button asChild className="gap-1.5">
          <Link href={`${basePath}/new`}><Plus className="h-4 w-4" /> New survey</Link>
        </Button>
      </div>

      {failed ? (
        <Card><CardContent className="p-5 text-sm text-destructive">The surveys could not be loaded. Refresh the page to try again.</CardContent></Card>
      ) : !surveys ? (
        <div aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : surveys.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No surveys yet. Start one with New survey.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted text-[13px]">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Survey</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Opens</th>
                  <th className="p-3 font-medium">Closes</th>
                  <th className="p-3 text-right font-medium">Responses</th>
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="p-3">
                      <Link href={`${basePath}/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link>
                      <div className="text-xs text-muted-foreground">
                        {[s.isAnonymous ? "Anonymous" : null, s.subGroupName].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td className="p-3">{STATE_LABEL[s.state]}</td>
                    <td className="p-3">{fmt.dateTime(s.opensAt)}</td>
                    <td className="p-3">{fmt.dateTime(s.closesAt)}</td>
                    <td className="p-3 text-right tabular-nums">{fmt.number(s.responseCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ErrorAlert open={!!error && !failed} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
