// AG-wise OCV/GOV report bundling: fetch every club (under the chosen AG) OCV report in the
// requested format and pack them into ONE ZIP the browser downloads. Reuses the per-club
// report endpoints (authenticated) — one file per club inside the zip. A club whose report
// fails is skipped so one bad club never sinks the whole bundle.

import JSZip from "jszip";
import { getDistrictOcvGovReport, fetchOcvReportWordBlob, fetchOcvReportExcelBlob } from "@/services/api";

const sanitize = (s: string) => (s || "").replace(/[^A-Za-z0-9\-]+/g, "_");

export async function downloadAgOcvZip(opts: {
  districtId: number;
  agMemberId: number;
  yearId: number;
  format: "word" | "excel";
  agName: string;
  districtNumber: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ total: number; added: number }> {
  const { districtId, agMemberId, yearId, format, agName, districtNumber, onProgress } = opts;

  const data = await getDistrictOcvGovReport(districtId, yearId, { agMemberId });
  const clubs = data.clubs || [];
  if (clubs.length === 0) return { total: 0, added: 0 };

  const zip = new JSZip();
  const ext = format === "word" ? "docx" : "xls";
  let done = 0;
  let added = 0;

  for (const c of clubs) {
    try {
      const blob = format === "word"
        ? await fetchOcvReportWordBlob(c.clubId, yearId)
        : await fetchOcvReportExcelBlob(c.clubId, yearId);
      zip.file(`${sanitize(c.clubName || `Club_${c.clubId}`)}_OCV.${ext}`, blob);
      added++;
    } catch {
      // Skip this club — keep bundling the rest.
    }
    done++;
    onProgress?.(done, clubs.length);
  }

  if (added === 0) return { total: clubs.length, added: 0 };

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = window.URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `District_${sanitize(districtNumber)}_${sanitize(agName || "AG")}_OCV_${format === "word" ? "Word" : "Excel"}.zip`;
  link.click();
  window.URL.revokeObjectURL(url);

  return { total: clubs.length, added };
}
