"use client";

import DetailRow from "@/components/DetailRow";
import PublishStatusBadge from "@/components/PublishStatusBadge";
import SectionCard from "@/components/form/SectionCard";
import { Card } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { DocumentDetail } from "@/types/document";
import { getClub, getDocument } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import { ArrowLeft, Pencil, FileText, Calendar, FileUp, ExternalLink, Download } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function AccessTypeBadge({ accessType }: { accessType: string }) {
  const isViewOnly = accessType === "view_only";
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${isViewOnly ? "bg-[#FFC65C] text-orange-700" : "bg-green-100 text-green-700"}`}>
      {isViewOnly ? "View Only" : "Downloadable"}
    </span>
  );
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function DocumentViewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const documentId = Number(params.documentId);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, doc] = await Promise.all([
          getClub(clubId),
          getDocument(clubId, documentId),
        ]);
        setClubName(club.clubName);
        setDocument(doc);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load document details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, documentId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  if (!document) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Document not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/documents`}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Documents
            </Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  const fileUrl = `${API_URL}${document.filePath}`;
  const displayFileName = document.originalFileName || document.filePath.split("/").pop() || "File";

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Documents` : "Documents"}
          description="Document Details"
          back={`/clubs/${clubId}/documents`}
          actions={canManage && document.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/documents/${documentId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        />

        {/* 1. Document Details */}
        <SectionCard icon={FileText} title="Document Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={document.title} />
            <DetailRow label="Status" value={<PublishStatusBadge status={document.status} />} />
            <DetailRow label="Access Type" value={<AccessTypeBadge accessType={document.accessType} />} />
          </div>
        </SectionCard>

        {/* 2. Dates */}
        <SectionCard icon={Calendar} title="Dates" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Publish Date & Time" value={formatDateTime(document.publishDateTime)} />
            <DetailRow label="Expiry Date & Time" value={formatDateTime(document.expiryDateTime)} />
          </div>
        </SectionCard>

        {/* 3. File */}
        <SectionCard icon={FileUp} title="File" number={3}>
          <div className="space-y-2">
            <DetailRow label="File Name" value={displayFileName} />
            <div className="space-y-0.5">
              {document.accessType === "view_only" ? (
                <Button
                  onClick={() => window.open(fileUrl, "_blank")}
                  variant="outline"
                >
                  <FileUp className="h-4 w-4" />
                  View
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <a
                  href={fileUrl}
                  download
                  className="row-btn row-btn-secondary"
                >
                  <FileUp className="h-4 w-4" />
                  Download
                  <Download className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </SectionCard>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
