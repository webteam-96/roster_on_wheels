namespace RotaryApi.Services;

/// <summary>
/// Best-effort work started from a request (emails, sheet appends, cache purges) that must not
/// block the response. Failures are logged instead of vanishing.
/// shortcut: in-process only, so work in flight is lost on an app restart; move to a durable queue if
/// any of these jobs becomes must-not-lose.
/// </summary>
public static class BackgroundWork
{
    /// <summary>Set once at startup from Program.cs.</summary>
    public static ILogger? Logger { get; set; }

    public static void Run(string what, Func<Task> work) =>
        _ = Task.Run(async () =>
        {
            try { await work(); }
            catch (Exception ex) { Logger?.LogError(ex, "Background work failed: {Work}", what); }
        });
}
