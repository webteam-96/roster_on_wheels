namespace RotaryApi.DTOs;

// Freeze-on-upload snapshot for a Club Monthly Report.
//
// When a CMR is "uploaded to district" its data is frozen: from that instant every PDF/Word
// download (club, district, AG, web AND mobile) must render EXACTLY what was uploaded — not the
// live tables — so the copy emailed to CP/CS/AG/DG never drifts if the admin edits afterwards.
// Re-uploading overwrites the snapshot. This container is serialized to
// club_monthly_reports.report_snapshot_json (MEDIUMTEXT).
public class CmrSnapshotDto
{
    // The report summary that feeds the on-screen preview AND the frontend-built PDF.
    public MonthlyReportPreviewDto Preview { get; set; } = new();

    // The detailed project/meeting rows (with photo paths) the server-side Word/PDF builder uses.
    public List<CmrWordProjectDto> WordProjects { get; set; } = new();
}
