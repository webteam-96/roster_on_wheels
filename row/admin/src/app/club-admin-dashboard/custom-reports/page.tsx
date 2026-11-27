"use client";

// Club Admin Dashboard › Report builder (components/custom-reports/ReportBuilder.tsx).
import { PageHeader } from "@/components/row/AppKit";
import ReportBuilder from "@/components/custom-reports/ReportBuilder";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubCustomReportsPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Report builder" description={<>Build a report on the club&apos;s members, attendance, dues, projects or contacts, then export it or email it to the officers every month.</>} />
      <ReportBuilder key={clubId} scope="club" scopeId={clubId} />
    </div>
  );
}
