import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import Link from "next/link";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { getCitationMatrix, getClub } from "@/services/api";
import { exportCitationMatrix } from "@/utils/citationMatrixExport";
import { Award, Download, Loader2 } from "@/components/icons";

// Club Report v2 — full per-section report (Club Service, Community Service,
// etc. with the new "Photos" hyperlink column). The active view is
// ClubReportV2PageImpl (exported below). The old stub which only offered the
// District Awards matrix download is preserved as ClubReportV2PageStub in case
// we need to revert.
export function ClubReportV2PageStub() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const yearIdRaw = searchParams.get("yearId");
  const yearId = yearIdRaw ? Number(yearIdRaw) : undefined;
  const returnToParam = searchParams.get("returnTo");
  const back = returnToParam ? decodeURIComponent(returnToParam) : "/club-admin-dashboard/e-governance";

  const [club, setClub] = useState<any>(null);
  const [downloading, setDownloading] = useState<null | "full" | "extended">(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const c = await getClub(clubId); if (!cancelled) setClub(c); }
      catch { if (!cancelled) setError("Failed to load club details."); }
    })();
    return () => { cancelled = true; };
  }, [clubId]);

  const handleDownload = async (compact: boolean) => {
    if (!club?.fkDistrictId) { setError("District not resolved for this club."); return; }
    setDownloading(compact ? "extended" : "full"); setError(null); setSuccess(null);
    try {
      const matrix = await getCitationMatrix(club.fkDistrictId, yearId, clubId);
      const slug = (club.clubName || `Club_${clubId}`).replace(/\s+/g, "_");
      const suffix = compact ? "District_Awards" : "District_Awards_Extended";
      const ok = exportCitationMatrix(matrix, { filenamePrefix: `${slug}_${suffix}`, compact });
      if (ok) setSuccess((compact ? "District Awards" : "District Awards Extended") + " exported.");
      else setError("No citation data to export for this club / year.");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to export.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <ClubAdminShell
      pageTitle="Club Report"
      pageSubtitle={club ? `${club.clubName} · District Awards` : "District Awards"}
      activeNavHref="/club-admin-dashboard/e-governance"
    >
      <div className="space-y-4">
        <Link
          href={back}
          className="row-btn row-btn-secondary row-btn-sm"
        >
          <ArrowLeft size={14} /> Back
        </Link>

        <Card className="p-5">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-blue-100 p-3">
              <Award className="h-6 w-6 text-blue-700" />
            </div>
            <div className="flex-1">
              <h2 className="row-h2">District Awards</h2>
              <p className="text-sm text-slate-500 mt-1">
                Download for this club only. Year is picked from the global search dropdown
                (current year if none selected).
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => handleDownload(true)}
                  disabled={downloading !== null || !club}
                  size="sm"
                >
                  {downloading === "extended" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>District Awards</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => handleDownload(false)}
                  disabled={downloading !== null || !club}
                  size="sm"
                >
                  {downloading === "full" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>District Awards Extended</span>
                </Button>
                {success && <span className="text-xs text-emerald-700">{success}</span>}
                {error && <span className="text-xs text-red-700">{error}</span>}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                District Awards: Total Points per question only. Extended: Base · Achieved · Total per question.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </ClubAdminShell>
  );
}
