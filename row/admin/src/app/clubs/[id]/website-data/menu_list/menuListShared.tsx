import dynamic from "next/dynamic";
import { LINK_TYPES } from "@/types/menu";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/icons";

export const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });
export function getLinkTypeLabel(value: string): string {
  return LINK_TYPES.find((t) => t.value === value)?.label || value;
}

// Build a URL openable in a new tab from a menu's linkType + linkValue.
// Document/file/pdf → prepend the API base for relative paths so the admin
// can open whatever was uploaded. External URLs pass through (with https://
// auto-prepended if missing). Page/html/empty → null (nothing to open).
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

// Renders the link-type Badge + an inline "Open in new tab" icon when the
// linkValue is openable (uploaded document, external URL). Single source so
// every menu/sub-menu badge in this page gets the same treatment.
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
          className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}

export function getLinkTypeBadgeVariant(value: string): "default" | "secondary" | "outline" {
  switch (value) {
    case "page": return "default";
    case "external": return "secondary";
    case "document": return "outline";
    default: return "secondary";
  }
}
