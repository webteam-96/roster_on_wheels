using System.Diagnostics;

namespace RotaryApi.Services;

// Converts an Office file (.doc/.docx/.xls/.xlsx) to PDF via LibreOffice headless
// (`soffice --headless --convert-to pdf`). The resulting PDF is then rasterised (first page)
// by the existing PDFium/Docnet path to produce an inline "snapshot" image in the OCV Word report.
//
// This is entirely OPTIONAL and self-contained: it is used ONLY when a LibreOffice `soffice`
// binary can be located. When LibreOffice is not installed, TryConvertAsync returns null and the
// caller falls back to a labelled entry (plus the download link). No paid/licensed dependency.
//
// Best-effort throughout: any failure (missing binary, conversion timeout, crash) returns null.
public static class OfficeToPdfConverter
{
    private static readonly object _probeGate = new();
    private static bool _probed;
    private static string? _sofficePath;

    // Serialise conversions — a shared LibreOffice user profile can't be used by two headless
    // instances at once, and each run already gets its own throwaway profile dir.
    private static readonly SemaphoreSlim _convertGate = new(1, 1);

    public static bool IsOfficeExtension(string? ext) =>
        (ext ?? "").ToLowerInvariant() is "doc" or "docx" or "xls" or "xlsx" or "ppt" or "pptx" or "odt" or "ods";

    /// <summary>
    /// Resolves the soffice binary once (config override → PATH → common install dirs) and caches
    /// the result. Returns null when LibreOffice isn't available on this machine.
    /// </summary>
    public static string? ResolveSoffice(string? configuredPath)
    {
        lock (_probeGate)
        {
            if (_probed && string.IsNullOrEmpty(configuredPath)) return _sofficePath;

            // 1) Explicit config wins.
            if (!string.IsNullOrWhiteSpace(configuredPath) && File.Exists(configuredPath))
            {
                _sofficePath = configuredPath;
                _probed = true;
                return _sofficePath;
            }

            // 2) Common install locations (Windows + Linux).
            var candidates = new[]
            {
                @"C:\Program Files\LibreOffice\program\soffice.exe",
                @"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                "/usr/bin/soffice",
                "/usr/bin/libreoffice",
                "/opt/libreoffice/program/soffice",
                "/snap/bin/libreoffice",
            };
            foreach (var c in candidates)
            {
                try { if (File.Exists(c)) { _sofficePath = c; _probed = true; return _sofficePath; } } catch { }
            }

            // 3) PATH lookup (soffice / libreoffice).
            try
            {
                var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
                var exeNames = OperatingSystem.IsWindows()
                    ? new[] { "soffice.exe", "soffice.com" }
                    : new[] { "soffice", "libreoffice" };
                foreach (var dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
                {
                    foreach (var exe in exeNames)
                    {
                        try
                        {
                            var full = Path.Combine(dir.Trim(), exe);
                            if (File.Exists(full)) { _sofficePath = full; _probed = true; return _sofficePath; }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            _sofficePath = null;
            _probed = true;
            return null;
        }
    }

    /// <summary>
    /// Converts the given Office file bytes to PDF bytes. Returns null when LibreOffice is
    /// unavailable or the conversion fails. Never throws.
    /// </summary>
    public static async Task<byte[]?> TryConvertAsync(byte[] fileBytes, string extension, string? configuredSofficePath, int timeoutMs = 90_000)
    {
        if (fileBytes == null || fileBytes.Length == 0) return null;
        var soffice = ResolveSoffice(configuredSofficePath);
        if (string.IsNullOrEmpty(soffice)) return null;

        var ext = (extension ?? "").TrimStart('.').ToLowerInvariant();
        if (string.IsNullOrEmpty(ext)) ext = "docx";

        var workDir = Path.Combine(Path.GetTempPath(), "ocv_office_" + Guid.NewGuid().ToString("N"));
        var profileDir = Path.Combine(workDir, "profile");
        var inputPath = Path.Combine(workDir, "input." + ext);

        await _convertGate.WaitAsync();
        try
        {
            Directory.CreateDirectory(workDir);
            Directory.CreateDirectory(profileDir);
            await File.WriteAllBytesAsync(inputPath, fileBytes);

            // Per-run throwaway user profile avoids the "another instance is running" profile lock.
            var profileUri = new Uri(profileDir).AbsoluteUri; // file:///...
            var psi = new ProcessStartInfo
            {
                FileName = soffice!,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = workDir,
            };
            psi.ArgumentList.Add("--headless");
            psi.ArgumentList.Add("--norestore");
            psi.ArgumentList.Add("--nolockcheck");
            psi.ArgumentList.Add("--nodefault");
            psi.ArgumentList.Add($"-env:UserInstallation={profileUri}");
            psi.ArgumentList.Add("--convert-to");
            psi.ArgumentList.Add("pdf");
            psi.ArgumentList.Add("--outdir");
            psi.ArgumentList.Add(workDir);
            psi.ArgumentList.Add(inputPath);

            using var proc = new Process { StartInfo = psi };
            if (!proc.Start()) return null;

            // Drain output so the pipe buffers can't deadlock the process.
            var _ = proc.StandardOutput.ReadToEndAsync();
            var __ = proc.StandardError.ReadToEndAsync();

            using var cts = new CancellationTokenSource(timeoutMs);
            try { await proc.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                return null;
            }

            var pdfPath = Path.Combine(workDir, "input.pdf");
            if (!File.Exists(pdfPath)) return null;
            return await File.ReadAllBytesAsync(pdfPath);
        }
        catch
        {
            return null;
        }
        finally
        {
            _convertGate.Release();
            try { if (Directory.Exists(workDir)) Directory.Delete(workDir, recursive: true); } catch { }
        }
    }
}
