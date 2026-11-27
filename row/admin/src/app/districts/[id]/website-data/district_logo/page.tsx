"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getDistrictLogo,
  uploadDistrictWebsiteLogo,
  getDistrict,
  getPhotoUrl,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { Upload, ImageIcon } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

export default function DistrictLogoPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [districtNumber, setDistrictNumber] = useState("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [districtData, logoData] = await Promise.all([
          getDistrict(districtId),
          getDistrictLogo(districtId),
        ]);
        setDistrictNumber(districtData.districtNumber);
        setLogoPath(logoData.logoPath || null);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [districtId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const extension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      setErrorMessage("Invalid file type. Allowed: jpg, jpeg, png, gif, webp");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("File size must be less than 5MB");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadDistrictWebsiteLogo(districtId, file);
      setLogoPath(result.path);
      setSuccessMessage("District logo updated successfully.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to upload logo.");
    } finally {
      setUploading(false);
    }
  };

  const logoUrl = logoPath ? getPhotoUrl(logoPath) : null;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title={districtNumber ? `District ${districtNumber} - District Logo` : "District Logo"} description="Manage the district logo image" back={`/districts/${districtId}/website-data`} />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {!loading && (
          <Card className="max-w-lg">
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label className="text-base font-semibold">Current Logo</Label>
                {logoUrl ? (
                  <div className="relative w-48 h-48 overflow-hidden rounded-lg border bg-muted">
                    <Image src={logoUrl} alt="District Logo" fill className="object-contain" unoptimized />
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-48 h-48 rounded-lg border border-dashed bg-muted">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ImageIcon className="h-12 w-12" />
                      <span className="text-sm">No logo uploaded</span>
                    </div>
                  </div>
                )}
              </div>

              {canManage && (
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Upload New Logo</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button
                    variant="outline"
                    className="w-full h-16"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {uploading ? "Uploading..." : "Click to upload new logo"}
                      </span>
                    </div>
                  </Button>
                  <p className="text-xs text-muted-foreground">Allowed: JPG, PNG, GIF, WebP. Max 5MB.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
