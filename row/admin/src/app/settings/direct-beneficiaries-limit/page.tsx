"use client";

import { useState, useEffect } from "react";
import { getSystemSetting, upsertSystemSetting } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Users, Loader2, Save } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const SETTING_KEY = "direct_beneficiaries_limit";

export default function DirectBeneficiariesLimitPage() {
  const { isSuperAdmin } = useAuth();

  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getSystemSetting(SETTING_KEY);
        if (data && data.settingValue) {
          setLimit(data.settingValue);
          setHasExisting(true);
        }
      } catch {
        // No setting yet
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!limit || Number(limit) <= 0) {
      setErrorMessage("Please enter a valid limit greater than 0.");
      return;
    }
    setSaving(true);
    try {
      await upsertSystemSetting(SETTING_KEY, limit, "Maximum direct beneficiaries allowed per project");
      setSuccessMessage(hasExisting ? "Limit updated successfully." : "Limit added successfully.");
      setHasExisting(true);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save limit.");
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Direct Beneficiaries Limit</h2>
            <p className="text-muted-foreground text-base">Set the maximum number of direct beneficiaries allowed per project</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        ) : (
          <Card className="max-w-md">
            <CardContent className="p-6 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="limit">Maximum Direct Beneficiaries</Label>
                <Input
                  id="limit"
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="Enter limit (e.g., 500)"
                  min="1"
                />
                <p className="text-xs text-muted-foreground">
                  Projects cannot exceed this number of direct beneficiaries. Set to 0 or leave empty for no limit.
                </p>
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {hasExisting ? "Update Limit" : "Add Limit"}
              </Button>
            </CardContent>
          </Card>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
