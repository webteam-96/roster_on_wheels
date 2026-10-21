"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getFeatures, setFeature, type PlatformFeature } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";

// Super Admin > Features: platform-wide module switches (api/Services/FeatureGate.cs). Flagged modules are built
// but off until switched on here; skipped modules are not part of ROW and are listed for reference only.
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
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const flagged = (features ?? []).filter((f) => f.kind === "flagged");
  const skipped = (features ?? []).filter((f) => f.kind === "skipped");

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings" aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Features</h2>
            <p className="text-muted-foreground text-base">Turn a module on for everyone. Club and district module settings still apply.</p>
          </div>
        </div>

        {features == null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-lg font-semibold">Off until switched on</h3>
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
            <section className="space-y-2">
              <h3 className="text-lg font-semibold">Not part of ROW</h3>
              <p className="text-sm text-muted-foreground">These modules are hidden and their API is closed. Changing this needs a code change.</p>
              <Card>
                <CardContent className="divide-y p-0">
                  {skipped.map((f) => <p key={f.key} className="p-4 text-sm">{f.label}</p>)}
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
