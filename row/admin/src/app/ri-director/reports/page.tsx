"use client";

import { useState } from "react";
import { downloadRiDirectorReport } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Globe, MapPin, Building2, Users2, MessageSquare, Download } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

type ReportKind = "zones" | "districts" | "clubs" | "members" | "communications";

const REPORTS: { kind: ReportKind; title: string; description: string; icon: React.ElementType; color: string }[] = [
  { kind: "zones", title: "Zones Summary", description: "All zones with district, club, and member counts", icon: Globe, color: "bg-blue-500" },
  { kind: "districts", title: "Districts Summary", description: "All districts with zone, club, and member counts", icon: MapPin, color: "bg-emerald-500" },
  { kind: "clubs", title: "Clubs Master", description: "Nationwide club list with district, zone, city, members", icon: Building2, color: "bg-amber-500" },
  { kind: "members", title: "Members Master", description: "All members with club/district/zone + contact info", icon: Users2, color: "bg-rose-500" },
  { kind: "communications", title: "Communications Log", description: "All RI announcements, events, emails, newsletters", icon: MessageSquare, color: "bg-violet-500" },
];

export default function Page() {
  const [downloading, setDownloading] = useState<ReportKind | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDownload = async (kind: ReportKind) => {
    setDownloading(kind);
    try {
      await downloadRiDirectorReport(kind);
      setSuccessMessage("Download started.");
    } catch { setErrorMessage("Failed to download."); }
    finally { setDownloading(null); }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild><Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director - Reports</h2>
            <p className="text-muted-foreground">Download Excel reports</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {REPORTS.map(r => (
            <Card key={r.kind}>
              <CardContent className="p-5 flex items-start gap-4">
                <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${r.color}`}>
                  <r.icon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{r.title}</h3>
                  <p className="text-sm text-muted-foreground">{r.description}</p>
                  <Button size="sm" className="mt-3" onClick={() => handleDownload(r.kind)} disabled={downloading === r.kind}>
                    {downloading === r.kind ? <RotaryLoader size="sm" /> : <><Download className="mr-2 h-4 w-4" />Download Excel</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
