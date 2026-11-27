"use client";

/** The surveys of a club or district (api/Controllers/SurveysController.cs), shared by both admin dashboards. */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { PageHeader } from "@/components/row/AppKit";
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
    <div className="space-y-6">
      <PageHeader
        title="Surveys and polls"
        description={<>Ask {audience} a question. They get a notification and answer in the app. Results come in as they answer, with charts and a CSV download.</>}
        actions={
          <>
<Button asChild>
          <Link href={`${basePath}/new`}><Plus className="h-4 w-4" /> New survey</Link>
        </Button>
          </>
        }
      />

      {failed ? (
        <Card><CardContent className="p-5 text-sm text-destructive">The surveys could not be loaded. Refresh the page to try again.</CardContent></Card>
      ) : !surveys ? (
        <div aria-busy="true"><TableSkeleton rows={4} /></div>
      ) : surveys.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No surveys yet. Start one with New survey.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[720px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="p-3">Survey</TableHead>
                  <TableHead className="p-3">Status</TableHead>
                  <TableHead className="p-3">Opens</TableHead>
                  <TableHead className="p-3">Closes</TableHead>
                  <TableHead className="p-3 text-right">Responses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surveys.map((s) => (
                  <TableRow key={s.id} className="border-b last:border-0">
                    <TableCell className="p-3">
                      <Link href={`${basePath}/${s.id}`} className="font-medium text-primary hover:underline">{s.title}</Link>
                      <div className="text-xs text-muted-foreground">
                        {[s.isAnonymous ? "Anonymous" : null, s.subGroupName].filter(Boolean).join(", ")}
                      </div>
                    </TableCell>
                    <TableCell className="p-3">{STATE_LABEL[s.state]}</TableCell>
                    <TableCell className="p-3">{fmt.dateTime(s.opensAt)}</TableCell>
                    <TableCell className="p-3">{fmt.dateTime(s.closesAt)}</TableCell>
                    <TableCell className="p-3 text-right tabular-nums">{fmt.number(s.responseCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ErrorAlert open={!!error && !failed} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
