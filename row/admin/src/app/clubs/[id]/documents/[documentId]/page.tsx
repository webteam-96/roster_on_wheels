"use client";

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
import {
  ArrowLeft, Pencil, FileText, Calendar, FileUp, ExternalLink, Download,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="relative bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-primary/5 border-b">
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

function AccessTypeBadge({ accessType }: { accessType: string }) {
  const isViewOnly = accessType === "view_only";
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${isViewOnly ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
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
          <RotaryLoader size="lg" />
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
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/documents`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Documents` : "Documents"}
              </h2>
              <p className="text-muted-foreground text-base">Document Details</p>
            </div>
          </div>
          {canManage && document.status !== "Expired" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/documents/${documentId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        </div>

        {/* 1. Document Details */}
        <Section icon={FileText} title="Document Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={document.title} />
            <DetailRow label="Status" value={<StatusBadge status={document.status} />} />
            <DetailRow label="Access Type" value={<AccessTypeBadge accessType={document.accessType} />} />
          </div>
        </Section>

        {/* 2. Dates */}
        <Section icon={Calendar} title="Dates" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Publish Date & Time" value={formatDateTime(document.publishDateTime)} />
            <DetailRow label="Expiry Date & Time" value={formatDateTime(document.expiryDateTime)} />
          </div>
        </Section>

        {/* 3. File */}
        <Section icon={FileUp} title="File" number={3}>
          <div className="space-y-2">
            <DetailRow label="File Name" value={displayFileName} />
            <div className="space-y-0.5">
              {document.accessType === "view_only" ? (
                <button
                  onClick={() => window.open(fileUrl, "_blank")}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium text-primary"
                >
                  <FileUp className="h-4 w-4" />
                  View
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : (
                <a
                  href={fileUrl}
                  download
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium text-primary"
                >
                  <FileUp className="h-4 w-4" />
                  Download
                  <Download className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </Section>

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
