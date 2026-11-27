"use client";

import DetailRow from "@/components/DetailRow";
import PublishStatusBadge from "@/components/PublishStatusBadge";
import SectionCard from "@/components/form/SectionCard";
import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { NewsletterDetail } from "@/types/newsletter";
import { getClub, getNewsletter } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import { ArrowLeft, Pencil, FileText, Bell, Calendar, Link2, FileUp, ExternalLink, Download } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function NewsletterViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const newsletterId = Number(params.newsletterId);
  const from = searchParams.get("from");
  const fromParam = from ? `?from=${from}` : "";
  const listUrl = `/clubs/${clubId}/newsletters${fromParam}`;
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [newsletter, setNewsletter] = useState<NewsletterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, nl] = await Promise.all([
          getClub(clubId),
          getNewsletter(clubId, newsletterId),
        ]);
        setClubName(club.clubName);
        setNewsletter(nl);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load newsletter details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, newsletterId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  if (!newsletter) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Newsletter not found.</p>
          <Button variant="outline" asChild>
            <Link href={listUrl}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Newsletters
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
          title={clubName ? `${clubName} - Newsletters` : "Newsletters"}
          description="Newsletter Details"
          back={listUrl}
          actions={canManage && newsletter.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/newsletters/${newsletterId}/edit${fromParam}`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        />

        {/* 1. Newsletter Details */}
        <SectionCard icon={FileText} title="Newsletter Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={newsletter.title} />
            <DetailRow label="Status" value={<PublishStatusBadge status={newsletter.status} />} />
          </div>
        </SectionCard>

        {/* 2. Dates */}
        <SectionCard icon={Calendar} title="Dates" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Publish Date & Time" value={formatDateTime(newsletter.publishDateTime)} />
          </div>
        </SectionCard>

        {/* 3. Attachment */}
        <SectionCard icon={Link2} title="Attachment" number={3}>
          <div className="space-y-2">
            <DetailRow label="Type" value={newsletter.attachmentType === "link" ? "Link" : "File (PDF)"} />
            {newsletter.attachmentType === "link" && newsletter.linkUrl && (
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link URL</p>
                <a
                  href={newsletter.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {newsletter.linkUrl}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
            {newsletter.attachmentType === "file" && newsletter.filePath && (
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">File</p>
                <a
                  href={`${API_URL}${newsletter.filePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="row-btn row-btn-secondary"
                >
                  <FileUp className="h-4 w-4" />
                  View / Download PDF
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            )}
          </div>
        </SectionCard>

        {/* 4. Notification Settings */}
        <SectionCard icon={Bell} title="Notification Settings" number={4}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Send Email" value={newsletter.isSendEmail ? "Yes" : "No"} />
          </div>
        </SectionCard>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
