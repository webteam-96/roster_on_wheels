"use client";

/**
 * Quick Links — District Admin dashboard landing.
 * -------------------------------------------------------------------------
 * 3-card grid linking to sub-pages under
 * /district-admin-dashboard/quick-links/*:
 *   - web-links   (curated URL / PDF / rich-page shortcuts)
 *   - sub-groups  (year-scoped member groupings)
 *   - mass-email  (draft + send mass emails to district recipients)
 *
 * districtId comes from useAuth().selectedDistrictId — the page lives under
 * the DA dashboard shell, no /districts/[id] URL param.
 *
 * Each sub-page card carries `returnTo=/district-admin-dashboard/quick-links`
 * forward so Save/Cancel/Back on any sub-page lands back here.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Zap, Link2, Users, Mail } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";

type ModuleKey = "web-links" | "sub-groups" | "mass-email";

interface Mod {
  key: ModuleKey;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  ring: string;
}

const MODULES: Mod[] = [
  { key: "web-links",  name: "Web Links",  description: "Curated URLs, PDFs & pages for the district",     icon: Link2, accent: "bg-blue-50 text-blue-700",       ring: "hover:border-blue-300" },
  { key: "sub-groups", name: "Sub Groups", description: "Custom member groupings for the current year",     icon: Users, accent: "bg-emerald-50 text-emerald-700", ring: "hover:border-emerald-300" },
  { key: "mass-email", name: "Mass Email", description: "Compose & send bulk emails to district recipients", icon: Mail,  accent: "bg-amber-50 text-amber-700",     ring: "hover:border-amber-300" },
];

export default function QuickLinksPage() {
  const { selectedDistrictId } = useAuth();
  const districtId = selectedDistrictId ?? 0;
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentYearId = searchParams.get("yearId");

  // Forward returnTo + yearId to the sub-pages so their Back button returns
  // HERE and their yearId stays in sync with the top bar.
  const forwardParams = new URLSearchParams();
  forwardParams.set("returnTo", "/district-admin-dashboard/quick-links");
  if (currentYearId) forwardParams.set("yearId", currentYearId);
  const suffix = `?${forwardParams.toString()}`;

  const [navigatingKey, setNavigatingKey] = useState<ModuleKey | null>(null);

  if (!districtId) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f]">
            <Zap size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Quick Links</h1>
            <p className="text-xs text-slate-500 mt-1">Fast access to Web Links, Sub Groups & Mass Email</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const busy = navigatingKey === mod.key;
          return (
            <button
              key={mod.key}
              type="button"
              onClick={() => {
                setNavigatingKey(mod.key);
                router.push(`/district-admin-dashboard/quick-links/${mod.key}${suffix}`);
              }}
              disabled={busy}
              className={`group text-left rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md ${mod.ring} ${busy ? "opacity-60 pointer-events-none" : ""}`}
            >
              <div className="flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${mod.accent}`}>
                  {busy ? <RotaryLoader size="sm" /> : <Icon className="h-6 w-6" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{mod.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{mod.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
