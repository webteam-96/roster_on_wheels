"use client";

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
import {
  ArrowLeft, Pencil, FileText, Bell, ExternalLink, Calendar,
} from "lucide-react";

import { appLocale } from "@/lib/appFormat";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="relative bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-primary/5 to-transparent border-b">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">{number}</div>
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "-") return null;
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Published: "bg-green-100 text-green-700",
    Expired: "bg-red-100 text-red-700",
    Unpublished: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

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
          <RotaryLoader size="lg" />
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
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/upcoming-events`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Upcoming Events` : "Upcoming Events"}
              </h2>
              <p className="text-muted-foreground text-base">Event Details</p>
            </div>
          </div>
          {canManage && event.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/upcoming-events/${eventId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        </div>

        {/* 1. Event Details */}
        <Section icon={FileText} title="Event Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={event.title} />
            <DetailRow label="Status" value={<StatusBadge status={event.status} />} />
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
        </Section>

        {/* 2. Dates & Venue */}
        <Section icon={Calendar} title="Dates & Venue" number={2}>
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
        </Section>

        {/* 3. Notification Settings */}
        <Section icon={Bell} title="Notification Settings" number={3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Send WhatsApp" value={event.isSendWhatsapp ? "Yes" : "No"} />
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
        </Section>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
