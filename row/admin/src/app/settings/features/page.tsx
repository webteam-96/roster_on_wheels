"use client";

import { PageHeader } from "@/components/row/AppKit";
import { useEffect, useState } from "react";
import { getFeatures, setFeature, type PlatformFeature } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";

// Super Admin > Features: platform-wide module switches (api/Services/FeatureGate.cs). Flagged modules are built
// but off until switched on here. Skipped modules (not part of ROW) stay closed in the API and are not listed.
export default function FeaturesPage() {
  const { isSuperAdmin } = useAuth();
  const [features, setFeatures] = useState<PlatformFeature[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    getFeatures().then(setFeatures).catch(() => setErrorMessage("Could not load the features."));
  }, [isSuperAdmin]);

  async function toggle(f: PlatformFeature, enabled: boolean) {
    setBusyKey(f.key);
    try {
      await setFeature(f.key, enabled);
      setFeatures((list) => (list ?? []).map((x) => (x.key === f.key ? { ...x, enabled } : x)));
      window.dispatchEvent(new Event("row:features-changed"));
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not change the feature.");
    } finally {
      setBusyKey(null);
    }
  }

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const flagged = (features ?? []).filter((f) => f.kind === "flagged");

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title="Features" description="Turn a module on for everyone. Club and district module settings still apply." back="/settings" />

        {features == null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="row-h2">Off until switched on</h3>
              <Card>
                <CardContent className="divide-y p-0">
                  {flagged.map((f) => (
                    <label key={f.key} className="flex items-center gap-3 p-4 text-sm">
                      <Checkbox checked={f.enabled} disabled={busyKey === f.key} onCheckedChange={(v) => toggle(f, v === true)} />
                      <span className="font-medium">{f.label}</span>
                      <span className="ml-auto text-muted-foreground">{f.enabled ? "On" : "Off"}</span>
                    </label>
                  ))}
                </CardContent>
              </Card>
            </section>
          </>
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
