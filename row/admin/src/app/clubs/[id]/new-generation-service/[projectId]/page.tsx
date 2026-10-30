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
  ArrowLeft, Pencil, MapPin, Target, IndianRupee, Camera, Star,
} from "@/components/icons";
import { getCurrencySymbol } from "@/lib/currency";

import { appLocale } from "@/lib/appFormat";
import { ListPageSkeleton } from "@/components/row/AppKit";
function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="relative bg-white rounded-[20px] border shadow-sm overflow-hidden">
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
  return new Date(dateStr).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function formatCost(cost: number, currency?: string | null): string {
  return `${getCurrencySymbol(currency)}${cost.toLocaleString(appLocale())}`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function NewGenerationServiceViewPage() {
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
        const [club, proj] = await Promise.all([getClub(clubId), getProject(clubId, yearId, projectId)]);
        setClubName(club.clubName);
        setProject(proj);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load project details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, projectId]);

  if (loading) {
    return <ProtectedRoute><div className="flex items-center justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;
  }

  if (!project) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Project not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/new-generation-service`}><ArrowLeft className="mr-2 h-4 w-4" />Back to New Generation Service</Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  let sectionNum = 1;

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/new-generation-service`}><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - New Generation Service` : "New Generation Service"}
              </h2>
              <p className="text-muted-foreground text-base">Project Details</p>
            </div>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => router.push(`/clubs/${clubId}/new-generation-service/${projectId}/edit?yearId=${yearId}`)}>
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        </div>

        {/* 1. Project Details */}
        <Section icon={MapPin} title="Project Details" number={sectionNum++}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Title" value={project.title} />
            {project.projectDate && <DetailRow label="Date" value={formatDate(project.projectDate)} />}
            {project.description && (
              <div className="sm:col-span-2"><DetailRow label="Description" value={project.description} /></div>
            )}
            {project.location && <DetailRow label="Location" value={project.location} />}
          </div>
        </Section>

        {/* 2. Classification — renamed labels */}
        <Section icon={Target} title="Category" number={sectionNum++}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Category" value={project.otherAreaOfFocus ? `Others: ${project.otherAreaOfFocus}` : project.areaOfFocusName} />
          </div>
        </Section>

        {/* Financial & Impact */}
        <Section icon={IndianRupee} title="Financial & Impact" number={sectionNum++}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {project.projectCost != null && <DetailRow label="Project Cost" value={formatCost(project.projectCost, project.currency)} />}
            <DetailRow label="Funding" value={project.fundingName} />
            {/* Funding-conditional read-only fields */}
            {project.globalGrantNumber && <DetailRow label="Global Grant Number" value={project.globalGrantNumber} />}
            {project.amountSanctioned != null && <DetailRow label="Amount Sanctioned" value={formatCost(project.amountSanctioned, project.currency)} />}
            {project.amountReceived != null && <DetailRow label="Amount Received" value={formatCost(project.amountReceived, project.currency)} />}
            {project.amountSpent != null && <DetailRow label="Amount Spent Till Date" value={formatCost(project.amountSpent, project.currency)} />}
            {project.hostClubsDistricts && <DetailRow label="Host Clubs/Districts" value={project.hostClubsDistricts} />}
            {project.globalPartnerClubsDistricts && <DetailRow label="Global Partner Clubs/Districts" value={project.globalPartnerClubsDistricts} />}
            {project.csrCompanyName && <DetailRow label="CSR Company" value={project.csrCompanyName} />}
            {project.directBeneficiaries != null && <DetailRow label="Direct Beneficiaries" value={project.directBeneficiaries.toLocaleString(appLocale())} />}
            {project.manHours != null && <DetailRow label="Man Hours" value={project.manHours.toLocaleString(appLocale())} />}
            {project.rotariansInvolved != null && <DetailRow label="Rotarians Involved" value={project.rotariansInvolved.toLocaleString(appLocale())} />}
            {project.rotaractorsInvolved != null && <DetailRow label="Rotaractors Involved" value={project.rotaractorsInvolved.toLocaleString(appLocale())} />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {project.projectCost != null && <DetailRow label="Project Cost" value={formatCost(project.projectCost, project.currency)} />}
            <DetailRow label="Funding" value={project.fundingName} />
            {/* Funding-conditional read-only fields */}
            {project.globalGrantNumber && <DetailRow label="Global Grant Number" value={project.globalGrantNumber} />}
            {project.amountSanctioned != null && <DetailRow label="Amount Sanctioned" value={formatCost(project.amountSanctioned, project.currency)} />}
            {project.amountReceived != null && <DetailRow label="Amount Received" value={formatCost(project.amountReceived, project.currency)} />}
            {project.amountSpent != null && <DetailRow label="Amount Spent Till Date" value={formatCost(project.amountSpent, project.currency)} />}
            {project.hostClubsDistricts && <DetailRow label="Host Clubs/Districts" value={project.hostClubsDistricts} />}
            {project.globalPartnerClubsDistricts && <DetailRow label="Global Partner Clubs/Districts" value={project.globalPartnerClubsDistricts} />}
            {project.csrCompanyName && <DetailRow label="CSR Company" value={project.csrCompanyName} />}
            {project.directBeneficiaries != null && <DetailRow label="Direct Beneficiaries" value={project.directBeneficiaries.toLocaleString(appLocale())} />}
            {project.manHours != null && <DetailRow label="Man Hours" value={project.manHours.toLocaleString(appLocale())} />}
            {project.rotariansInvolved != null && <DetailRow label="Rotarians Involved" value={project.rotariansInvolved.toLocaleString(appLocale())} />}
            {project.rccInvolved != null && <DetailRow label="RCC Involved" value={project.rccInvolved.toLocaleString(appLocale())} />}
          </div>
        </Section>

        {/* Photos */}
        {project.photos && project.photos.length > 0 && (
          <Section icon={Camera} title="Photos" number={sectionNum++}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {project.photos.map((photo) => (
                <div key={photo.id} className="relative rounded-xl border overflow-hidden bg-muted/30">
                  <div className="relative">
                    <img src={`${API_URL}${photo.imagePath}`} alt={photo.description || "Project photo"} className="h-48 w-full object-contain" />
                    {photo.isPrimary && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-medium shadow">
                        <Star className="h-3 w-3 fill-white" />Primary
                      </div>
                    )}
                  </div>
                  {photo.description && <div className="p-3"><p className="text-sm text-muted-foreground">{photo.description}</p></div>}
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
