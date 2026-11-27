import { Card } from "@/components/ui/card";
import { Calendar, DollarSign, FolderOpen, Users } from "@/components/icons";
import { appLocale } from "@/lib/appFormat";

// ── Constants (parity with v1) ─────────────────────────────────────────────

export const STEPS = [
  { key: "meetings", label: "Meetings",     icon: Calendar    },
  { key: "trf",      label: "TRF",          icon: DollarSign  },
  { key: "projects", label: "Projects",     icon: FolderOpen  },
  { key: "members",  label: "Members Info", icon: Users       },
] as const;

export const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

export const MEETING_TYPE_COLORS: Record<string, string> = {
  regular:    "bg-blue-50    text-blue-700    border-blue-200",
  fellowship: "bg-slate-50  text-slate-700  border-slate-200",
  bod:        "bg-amber-50   text-amber-700   border-amber-200",
  assembly:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  trust:      "bg-rose-50    text-rose-700    border-rose-200",
};

export const PROJECT_LABELS: Record<string, string> = {
  community_service:        "Community Service",
  vocational_service:       "Vocational Service",
  international_service:    "International Service",
  new_generation_service:   "New Generation Service",
  public_image_initiative:  "Public Image Initiative",
};

// v2 add/edit paths for project modules — wizard prefers v2 routes.
export const PROJECT_ROUTES_V2: Record<string, string> = {
  community_service:        "community-service/v2",
  vocational_service:       "vocational-service/v2",
  international_service:    "international-service/v2",
  new_generation_service:   "new-generation-service/v2",
  public_image_initiative:  "public-image-initiative/v2",
};

export const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Tiny helpers ────────────────────────────────────────────────────────────

export function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// Visual scaffold matching V2FormShell's idiom (rounded section card with
// dot-accented header, slate-tone chrome) — used for each step's content.
export function SectionCard({
  icon: Icon, title, action, children,
}: { icon: React.ElementType; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[color:var(--row-line)]">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          <h3 className="row-h2">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}
