"use client";

/**
 * Social Media Links v2 — Add Social Link.
 *
 * Extracted from the v1 inline add dialog in
 * `app/clubs/[id]/website-data/social_media_links/page.tsx`. Every field,
 * every API call, every validation rule is preserved verbatim. Only the
 * visual presentation differs (V2FormShell wrapper, dot-accented section
 * headers, sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import SectionCard from "@/components/form/SectionCard";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Share2, Link2, ToggleRight } from "@/components/icons";
import {
  getClub,
  getClubSocialLinks,
  createClubSocialLink,
} from "@/services/api";
import { SOCIAL_PLATFORMS } from "@/types/socialLink";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { ListPageSkeleton } from "@/components/row/AppKit";

export default function SocialMediaLinksV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/website-data/social_media_links/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Existing records — used to compute next sortOrder (parity with v1).
  const [existingMaxSort, setExistingMaxSort] = useState(0);

  // Form fields — preserved verbatim from v1.
  const [formPlatform, setFormPlatform] = useState("");
  const [formLinkUrl, setFormLinkUrl] = useState("");
  const [formIsActive, setFormIsActive] = useState("1");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [club, links] = await Promise.all([
          getClub(clubId),
          getClubSocialLinks(clubId),
        ]);
        if (cancelled) return;
        setClubName(club.clubName);
        setExistingMaxSort(links.length > 0 ? Math.max(...links.map((l) => l.sortOrder)) : 0);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        if (!cancelled) setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [clubId]);

  const handleSave = async () => {
    if (!formPlatform) { setErrorMessage("Please select a social media platform."); return; }
    if (!formLinkUrl.trim()) { setErrorMessage("Please enter the link URL."); return; }

    setSaving(true);
    try {
      await createClubSocialLink(clubId, {
        platform: formPlatform,
        linkUrl: formLinkUrl.trim(),
        sortOrder: existingMaxSort + 1,
        isActive: formIsActive === "1",
      });
      setSuccessMessage("Social link added successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { message?: string } | string }; message?: string };
      const apiMsg =
        (typeof anyErr.response?.data === "object" && anyErr.response?.data?.message) ||
        (typeof anyErr.response?.data === "string" ? anyErr.response.data : undefined) ||
        anyErr.message ||
        "Failed to save social link.";
      setErrorMessage(apiMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <ClubAdminShell
          pageTitle="Add Social Media Link"
          pageSubtitle="Add a new social link"
          activeNavHref="/club-admin-dashboard/my-club-website"
        >
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        </ClubAdminShell>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Add Social Media Link"
        pageSubtitle="Add a new social link"
        activeNavHref="/club-admin-dashboard/my-club-website"
      >
      <V2FormShell
        title="Add Social Link"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/website-data/social_media_links/v2`}
        saving={saving}
        saveLabel="Save Social Link"
        onSave={handleSave}
      >
        {/* 1. Platform */}
        <SectionCard number={1} icon={Share2} title="Platform">
          <FieldLabel required>Social Media Platform</FieldLabel>
          <NativeSelect
            value={formPlatform}
            onChange={(e) => setFormPlatform(e.target.value)}
            
          >
            <option value="">Select a platform</option>
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </NativeSelect>
        </SectionCard>

        {/* 2. Link URL */}
        <SectionCard number={2} icon={Link2} title="Link URL">
          <FieldLabel required>URL</FieldLabel>
          <Input
            type="text"
            placeholder="https://…"
            value={formLinkUrl}
            onChange={(e) => setFormLinkUrl(e.target.value)}
            
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Full URL including protocol (https://). Will be made clickable on the public website.
          </p>
        </SectionCard>

        {/* 3. Status */}
        <SectionCard number={3} icon={ToggleRight} title="Visibility">
          <FieldLabel>Status</FieldLabel>
          <NativeSelect
            value={formIsActive}
            onChange={(e) => setFormIsActive(e.target.value)}
            
          >
            <option value="1">Active: shown on public website</option>
            <option value="0">Inactive: hidden</option>
          </NativeSelect>
        </SectionCard>

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Social link added successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
