"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createZone } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function NewZonePage() {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneName.trim()) {
      setErrorMessage("Zone name is required.");
      return;
    }
    if (zoneName.trim().length > 100) {
      setErrorMessage("Zone name must be 100 characters or less.");
      return;
    }
    setLoading(true);
    try {
      await createZone({ zoneName: zoneName.trim(), isActive });
      setShowSuccess(true);
    } catch (err) {
      const message = err && typeof err === "object" && "response" in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message || "Failed to create zone."
        : "Failed to create zone.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can create zones.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">New Zone</h2>
              <p className="text-muted-foreground text-base">Create a new Rotary zone</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/")}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <RotaryLoader size="sm" />}
              Create Zone
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Zone Details</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid gap-4 max-w-md mx-auto">
                <div className="space-y-2">
                  <Label htmlFor="zoneName">Zone Name<span className="text-destructive ml-1">*</span></Label>
                  <Input id="zoneName" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="e.g., South Asia" maxLength={100} required />
                  <p className="text-xs text-muted-foreground">Zone Name is required</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" id="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
                  <Label htmlFor="isActive">Active</Label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
      <SuccessAlert open={showSuccess} title="Zone Created" description="Zone created successfully." onOk={() => router.push("/")} />
      <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
    </ProtectedRoute>
  );
}
