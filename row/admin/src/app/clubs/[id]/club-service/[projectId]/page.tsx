"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ProjectDetail } from "@/types/project";
import { getClub, getProject } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import {
  ArrowLeft, Pencil, FileText, Calendar, Users, Camera, Star,
  FileUp, ExternalLink,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
const MEETING_TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  fellowship: "Fellowship",
  bod: "BOD",
  assembly: "Assembly",
  trust: "Trust",
};

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(appLocale(), {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function ClubServiceViewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const projectId = Number(params.projectId);
  const yearId = Number(searchParams.get("yearId") || searchParams.get("frozenYearId")) || 0;
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, proj] = await Promise.all([
          getClub(clubId),
          getProject(clubId, yearId, projectId),
        ]);
        setClubName(club.clubName);
        setProject(proj);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load meeting details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, projectId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  if (!project) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Meeting not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/club-service`}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Club Service
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
              <Link href={`/clubs/${clubId}/club-service`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - Club Service` : "Club Service"}
              </h2>
              <p className="text-muted-foreground text-base">Meeting Details</p>
            </div>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/club-service/${projectId}/edit?yearId=${yearId}`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        </div>

        {/* 1. Meeting Details */}
        <Section icon={FileText} title="Meeting Details" number={1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={project.title} />
            {project.projectDate && (
              <DetailRow label="Date" value={formatDate(project.projectDate)} />
            )}
            {project.description && (
              <div className="sm:col-span-2">
                <DetailRow label="Description" value={project.description} />
              </div>
            )}
          </div>
        </Section>

        {/* 2. Meeting Type */}
        <Section icon={Calendar} title="Meeting Type" number={2}>
          <DetailRow
            label="Type"
            value={
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-700">
                {MEETING_TYPE_LABELS[project.meetingType || ""] || project.meetingType || "-"}
              </span>
            }
          />
        </Section>

        {/* 3. Documents */}
        {(project.agendaDocument || project.minutesDocument) && (
          <Section icon={FileUp} title="Documents" number={3}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {project.agendaDocument && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agenda</p>
                  <a
                    href={`${API_URL}${project.agendaDocument}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    View Agenda
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {project.minutesDocument && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Minutes of Meeting</p>
                  <a
                    href={`${API_URL}${project.minutesDocument}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    View Minutes
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* 4. Attendance */}
        <Section icon={Users} title="Attendance" number={project.agendaDocument || project.minutesDocument ? 4 : 3}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {project.attendance != null && (
              <DetailRow label="Attendance" value={project.attendance} />
            )}
            {project.attendancePercentage != null && (
              <DetailRow label="Attendance (%)" value={`${project.attendancePercentage}%`} />
            )}
          </div>
        </Section>

        {/* 5. Photos */}
        {project.photos && project.photos.length > 0 && (
          <Section icon={Camera} title="Photos" number={project.agendaDocument || project.minutesDocument ? 5 : 4}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {project.photos.map((photo) => (
                <div key={photo.id} className="relative rounded-xl border overflow-hidden bg-muted/30">
                  <div className="relative">
                    <img
                      src={`${API_URL}${photo.imagePath}`}
                      alt={photo.description || "Meeting photo"}
                      className="h-48 w-full object-contain"
                    />
                    {photo.isPrimary && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-medium shadow">
                        <Star className="h-3 w-3 fill-white" />Primary
                      </div>
                    )}
                  </div>
                  {photo.description && (
                    <div className="p-3">
                      <p className="text-sm text-muted-foreground">{photo.description}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
