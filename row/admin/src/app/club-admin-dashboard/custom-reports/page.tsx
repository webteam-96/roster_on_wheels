"use client";

// Club Admin Dashboard › Report builder (components/custom-reports/ReportBuilder.tsx).
import ReportBuilder from "@/components/custom-reports/ReportBuilder";
import { useAuth } from "@/contexts/AuthContext";

export default function ClubCustomReportsPage() {
  const { selectedClubId: clubId } = useAuth();
  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Report builder</h2>
        <p className="text-base text-muted-foreground">Build a report on the club&apos;s members, attendance, dues, projects or contacts, then export it or email it to the officers every month.</p>
      </div>
      <ReportBuilder key={clubId} scope="club" scopeId={clubId} />
    </div>
  );
}
