"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDistrict } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Users, UsersRound, AlertCircle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

const COMMITTEE_MODULES = [
  { key: "committee", name: "District Committee", description: "Manage direct committee members", icon: "Users", route: "committee" },
  { key: "groups", name: "Group Committee", description: "Manage groups with members & sub-groups", icon: "UsersRound", route: "groups" },
];

function getIcon(iconName: string) {
  const map: Record<string, React.ReactNode> = {
    Users: <Users className="h-10 w-10 text-primary" />,
    UsersRound: <UsersRound className="h-10 w-10 text-primary" />,
  };
  return map[iconName] || <Users className="h-10 w-10 text-primary" />;
}

export default function DistrictCommitteePage() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
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
          <Button variant="outline" size="icon" onClick={() => router.push(`/districts/${districtId}/dashboard`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {districtNumber ? `District ${districtNumber} - Committee` : "District Committee"}
            </h2>
            <p className="text-muted-foreground text-base">Manage district committee members and groups</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {COMMITTEE_MODULES.map((mod) => (
              <Card
                key={mod.key}
                className={`cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${navigatingKey === mod.key ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingKey(mod.key);
                  router.push(`/districts/${districtId}/district-committee/${mod.route}`);
                }}
              >
                <CardContent className="flex flex-col items-center justify-center p-6 text-center gap-3">
                  {navigatingKey === mod.key ? <RotaryLoader size="sm" /> : getIcon(mod.icon)}
                  <div>
                    <p className="font-semibold text-sm">{mod.name}</p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
