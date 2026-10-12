"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Club } from "@/types/club";
import { WebsiteDataModule } from "@/types/websiteDataModule";
import { getClub, getWebsiteDataModules, getClubHasWebsite } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertCircle, Globe } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import ModuleIcon from "@/components/ModuleIcon";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubWebsiteDataPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const [club, setClub] = useState<Club | null>(null);
  const [modules, setModules] = useState<WebsiteDataModule[]>([]);
  const [hasWebsite, setHasWebsite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [clubData, modulesData, hasWebsiteResult] = await Promise.all([
          getClub(clubId),
          getWebsiteDataModules(),
          getClubHasWebsite(clubId),
        ]);
        setClub(clubData);
        setModules(modulesData);
        setHasWebsite(hasWebsiteResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [clubId]);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push(`/clubs/${clubId}/dashboard`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {club ? `${club.clubName} - Website Data` : "Website Data"}
            </h2>
            <p className="text-muted-foreground text-base">
              Manage club website content
            </p>
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

        {!loading && !error && modules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No sub-modules found</h3>
            <p className="text-muted-foreground mt-2">
              No website data modules have been configured yet.
            </p>
          </div>
        )}

        {!loading && !error && !hasWebsite && modules.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Club website not created yet</p>
                {isSuperAdmin ? (
                  <p className="text-sm mt-1">
                    These modules are inactive until you create a club website from <span className="font-medium">Settings &rarr; Club Websites</span>.
                  </p>
                ) : (
                  <div className="text-sm mt-1 space-y-1">
                    <p>These modules are inactive until a club website is created for your club.</p>
                    <p>
                      For assistance, please contact support:
                      {" "}<span className="font-medium"></span> / <span className="font-medium"></span>
                      {" "}(Mon&ndash;Fri, 10:00 AM &ndash; 6:30 PM)
                      {" "}or email <a href="mailto:support@example.org" className="font-medium underline">support@example.org</a>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && !error && modules.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {modules.map((mod) => {
              const disabled = !hasWebsite;
              return (
                <Card
                  key={mod.id}
                  className={
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : `cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${navigatingKey === mod.moduleKey ? "opacity-70 pointer-events-none" : ""}`
                  }
                  onClick={() => {
                    if (disabled) return;
                    setNavigatingKey(mod.moduleKey);
                    router.push(`/clubs/${clubId}/website-data/${mod.moduleKey}`);
                  }}
                  title={disabled ? "Club website not created yet" : undefined}
                >
                  <CardContent className="flex flex-col items-center justify-center p-6 text-center gap-3">
                    {!disabled && navigatingKey === mod.moduleKey ? (
                      <RotaryLoader size="sm" />
                    ) : (
                      <ModuleIcon
                        name={mod.iconClass}
                        className="h-10 w-10 text-primary"
                      />
                    )}
                    <div>
                      <p className="font-semibold text-sm">{mod.moduleName}</p>
                      <p className="text-xs text-muted-foreground">
                        {mod.moduleKey}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
