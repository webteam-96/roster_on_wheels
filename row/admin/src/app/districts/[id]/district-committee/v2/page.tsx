"use client";

/**
 * District Committee — V2 landing (dashboard palette).
 *
 * Mirrors `/districts/[id]/district-committee/page.tsx` (V1) 1:1 in behaviour;
 * only the visual chrome changes to match the new design language used on
 * `district-admin-dashboard/membership/page.tsx` (navy #17458f + gold #F7A81B).
 *
 * ?returnTo=<url> — every navigation button (back + module cards forward)
 * honours this. If absent, back falls through to /districts/{id}/dashboard,
 * and forward links carry no returnTo suffix.
 */

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getDistrict } from "@/services/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, UsersRound, AlertCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

const COMMITTEE_MODULES = [
  { key: "committee", name: "District Committee", description: "Manage direct committee members", icon: "Users", route: "committee" },
  { key: "groups", name: "Group Committee", description: "Manage groups with members & sub-groups", icon: "UsersRound", route: "groups" },
];

function getIcon(iconName: string) {
  const map: Record<string, React.ReactNode> = {
    Users: <Users className="h-10 w-10 text-ink" />,
    UsersRound: <UsersRound className="h-10 w-10 text-ink" />,
  };
  return map[iconName] || <Users className="h-10 w-10 text-ink" />;
}

export default function DistrictCommitteeV2Page() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/districts/${districtId}/dashboard`;
  const goBack = () => router.push(returnTo || fallbackBack);

  // Propagate returnTo forward so committee/groups sub-pages know where to
  // return the user after Save/Cancel.
  const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  const [districtNumber, setDistrictNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const district = await getDistrict(districtId);
        setDistrictNumber(district.districtNumber);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [districtId]);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={goBack}
            className="border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              {districtNumber ? `District ${districtNumber} - Committee` : "District Committee"}
            </h2>
            <p className="text-slate-600 text-base">Manage district committee members and groups</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white shadow-sm">
            <AlertCircle className="h-12 w-12 text-red-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-800">Error</h3>
            <p className="text-slate-600 mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {COMMITTEE_MODULES.map((mod) => (
              <div
                key={mod.key}
                className={`cursor-pointer rounded-2xl border border-slate-200 shadow-sm bg-white transition-all hover:shadow-md hover:border-azure/30 ${navigatingKey === mod.key ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingKey(mod.key);
                  router.push(`/districts/${districtId}/district-committee/v2/${mod.route}${suffix}`);
                }}
              >
                <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
                  {navigatingKey === mod.key ? <RotaryLoader size="sm" /> : getIcon(mod.icon)}
                  <div>
                    <p className="font-semibold text-sm text-slate-800">{mod.name}</p>
                    <p className="text-xs text-slate-500">{mod.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
