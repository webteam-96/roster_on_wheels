"use client";

import DetailRow from "@/components/DetailRow";
import PublishStatusBadge from "@/components/PublishStatusBadge";
import SectionCard from "@/components/form/SectionCard";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { UpcomingEventDetail } from "@/types/upcomingEvent";
import { getClub, getUpcomingEvent } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import { ArrowLeft, Pencil, FileText, Bell, ExternalLink, Calendar } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function UpcomingEventViewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const eventId = Number(params.eventId);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [event, setEvent] = useState<UpcomingEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, evt] = await Promise.all([
          getClub(clubId),
          getUpcomingEvent(clubId, eventId),
        ]);
        setClubName(club.clubName);
        setEvent(evt);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load event details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, eventId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  if (!event) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Event not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/upcoming-events`}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Upcoming Events
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
          title={clubName ? `${clubName} - Upcoming Events` : "Upcoming Events"}
          description="Event Details"
          back={`/clubs/${clubId}/upcoming-events`}
          actions={canManage && event.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/upcoming-events/${eventId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        />

        {/* 1. Event Details */}
        <SectionCard icon={FileText} title="Event Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={event.title} />
            <DetailRow label="Status" value={<PublishStatusBadge status={event.status} />} />
            {event.imagePath && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Image</p>
                <img
                  src={`${API_URL}${event.imagePath}`}
                  alt={event.title}
                  className="h-48 w-auto object-cover rounded-lg border"
                />
              </div>
            )}
            {event.description && (
              <div className="sm:col-span-2">
                <DetailRow label="Description" value={event.description} />
              </div>
            )}
          </div>
        </SectionCard>

        {/* 2. Dates & Venue */}
        <SectionCard icon={Calendar} title="Dates & Venue" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Event Date" value={formatDateTime(event.eventDate)} />
            <DetailRow label="Publish Date" value={formatDateTime(event.publishDate)} />
            <DetailRow label="Expiry Date" value={formatDateTime(event.expiryDate)} />
            {event.eventVenue && (
              <DetailRow label="Event Venue" value={event.eventVenue} />
            )}
            {event.registrationLink && (
              <div className="sm:col-span-2 space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Registration Link</p>
                <a
                  href={event.registrationLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  {event.registrationLink}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </SectionCard>

        {/* 3. Notification Settings */}
        <SectionCard icon={Bell} title="Notification Settings" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Send Email" value={event.isSendEmail ? "Yes" : "No"} />
            <DetailRow label="Repeat Notification" value={event.isRepeatNotification ? "Yes" : "No"} />
            {event.reminders && event.reminders.length > 0 && (
              <div className="sm:col-span-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reminders</p>
                <ul className="space-y-1">
                  {event.reminders.map((r) => (
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
