"use client";

// Public OCV Live-Documents "Download Word" button. The .docx is generated server-side and can
// take several seconds, so this fetches it as a blob with a visible spinner (instead of a plain
// anchor that gives no feedback), then triggers the browser download.

import { useState } from "react";
import { Download, Loader2 } from "@/components/icons";

export function OcvModuleWordButton({ wordUrl, fileName }: { wordUrl: string; fileName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(wordUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not generate the Word file. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col items-center text-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
        className="btn inline-flex min-h-11 items-center gap-2 bg-navy-800 text-cream hover:text-gold hover:shadow-glow-royal disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {loading ? "Generating…" : "Download in Word Document"}
      </button>
      {error && <p className="mt-2 text-[13px] text-red-600" role="alert">{error}</p>}
    </div>
  );
}
