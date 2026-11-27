"use client";

import DetailRow from "@/components/DetailRow";
import PublishStatusBadge from "@/components/PublishStatusBadge";
import SectionCard from "@/components/form/SectionCard";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnnouncementDetail } from "@/types/announcement";
import { getClub, getAnnouncement } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import { ArrowLeft, Pencil, FileText, Bell, Calendar } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AnnouncementViewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const announcementId = Number(params.announcementId);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, ann] = await Promise.all([
          getClub(clubId),
          getAnnouncement(clubId, announcementId),
        ]);
        setClubName(club.clubName);
        setAnnouncement(ann);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load announcement details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, announcementId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  if (!announcement) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Announcement not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/announcements`}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Announcements
            </Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Announcements` : "Announcements"}
          description="Announcement Details"
          back={`/clubs/${clubId}/announcements`}
          actions={canManage && announcement.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/announcements/${announcementId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        />

        {/* 1. Announcement Details */}
        <SectionCard icon={FileText} title="Announcement Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={announcement.title} />
            <DetailRow label="Status" value={<PublishStatusBadge status={announcement.status} />} />
            {announcement.imagePath && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Image</p>
                <img
                  src={`${API_URL}${announcement.imagePath}`}
                  alt={announcement.title}
                  className="h-48 w-auto object-cover rounded-lg border"
                />
              </div>
            )}
            {announcement.description && (
              <div className="sm:col-span-2">
                <DetailRow label="Description" value={announcement.description} />
              </div>
            )}
          </div>
        </SectionCard>

        {/* 2. Dates */}
        <SectionCard icon={Calendar} title="Dates" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Publish Date & Time" value={formatDateTime(announcement.publishDateTime)} />
            <DetailRow label="Expiry Date & Time" value={formatDateTime(announcement.expiryDateTime)} />
          </div>
        </SectionCard>

        {/* 3. Display & Notification Settings */}
        <SectionCard icon={Bell} title="Display & Notification Settings" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Display On Banner" value={announcement.isDisplayOnBanner ? "Yes" : "No"} />
            <DetailRow label="Send Email" value={announcement.isSendEmail ? "Yes" : "No"} />
            <DetailRow label="Repeat Notification" value={announcement.isRepeatNotification ? "Yes" : "No"} />
            {announcement.reminders && announcement.reminders.length > 0 && (
              <div className="sm:col-span-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reminders</p>
                <ul className="space-y-1">
                  {announcement.reminders.map((r) => (
                    <li key={r.id} className="text-sm font-medium flex items-center gap-2">
                      <Bell className="h-3 w-3 text-primary" />
                      {formatDateTime(r.reminderDateTime)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SectionCard>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
