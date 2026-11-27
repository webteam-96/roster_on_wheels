"use client";

// District Admin Dashboard › Report builder (components/custom-reports/ReportBuilder.tsx): covers every club of the district.
import { PageHeader } from "@/components/row/AppKit";
import ReportBuilder from "@/components/custom-reports/ReportBuilder";
import { useAuth } from "@/contexts/AuthContext";

export default function DistrictCustomReportsPage() {
  const { selectedDistrictId: districtId } = useAuth();
  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;
  return (
    <div className="space-y-6">
      <PageHeader title="Report builder" description={<>Build a report across the district&apos;s clubs, then export it or email it to the district officers every month.</>} />
      <ReportBuilder key={districtId} scope="district" scopeId={districtId} />
    </div>
  );
}
