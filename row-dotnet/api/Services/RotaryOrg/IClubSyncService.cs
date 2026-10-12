namespace RotaryApi.Services.RotaryOrg;

public interface IClubSyncService
{
    /// <summary>
    /// Triggers a background full sync. Returns immediately with the sync log row id.
    /// Poll /api/admin/rotary-org-sync/status/{id} to track progress.
    /// Emails a 3-sheet Excel report (New / Updated / Disabled) to the triggering user on completion.
    /// </summary>
    Task<int> StartBootstrapAsync(string triggeredByEmail, string triggeredByName, int triggeredByMemberId);

    /// <summary>
    /// Returns status snapshot for a given sync log row (for polling).
    /// </summary>
    Task<SyncStatusDto?> GetStatusAsync(int logId);
}

public class SyncStatusDto
{
    public int LogId { get; set; }
    public string SyncType { get; set; } = "";
    public string Status { get; set; } = "";    // Running / Completed / Failed
    public DateTime StartedAtUtc { get; set; }
    public DateTime? FinishedAtUtc { get; set; }
    public int TotalFetched { get; set; }
    public int InsertedCount { get; set; }
    public int UpdatedCount { get; set; }
    public int DisabledCount { get; set; }
    public int SkippedDistrictMissing { get; set; }
    public int ErrorCount { get; set; }
    public string? ErrorDetail { get; set; }
    public int? DurationSeconds => FinishedAtUtc == null ? null : (int)(FinishedAtUtc.Value - StartedAtUtc).TotalSeconds;
}
