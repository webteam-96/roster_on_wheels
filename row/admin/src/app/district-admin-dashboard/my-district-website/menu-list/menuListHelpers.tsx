"use client";

import { LINK_TYPES } from "@/types/menu";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/icons";


export function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

export function getLinkTypeBadgeVariant(value: string): "default" | "secondary" | "outline" {
  switch (value) {
    case "page": return "default";
    case "external": return "secondary";
    case "document": return "outline";
    default: return "secondary";
  }
}

// Build a URL openable in a new tab — used by LinkTypeBadgeWithView so the
// admin can preview any uploaded document / external URL. Document/file/pdf
// values are prepended with the API base if relative. External URLs are
// passed through (with https:// auto-prepended). Page/html → null.
export function resolveOpenUrl(linkType: string, linkValue: string | null | undefined): string | null {
  if (!linkValue || !linkValue.trim()) return null;
  const v = linkValue.trim();
  if (linkType === "document" || linkType === "file" || linkType === "pdf") {
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");
    return base + (v.startsWith("/") ? v : "/" + v);
  }
  if (linkType === "external" || linkType === "url" || linkType === "weblink") {
    if (v.startsWith("http://") || v.startsWith("https://")) return v;
    return "https://" + v;
  }
  return null;
}

export function LinkTypeBadgeWithView({ linkType, linkValue, className }: {
  linkType: string;
  linkValue: string | null | undefined;
  className?: string;
}) {
  const openUrl = resolveOpenUrl(linkType, linkValue);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={getLinkTypeBadgeVariant(linkType)} className={className}>
        {getLinkTypeLabel(linkType)}
      </Badge>
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open uploaded file / link in a new tab"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-ink hover:bg-slate-100"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}
