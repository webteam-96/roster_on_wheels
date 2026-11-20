"use client";

/** District Admin Dashboard › Committees: subcommittee tree, private documents and committee email (flag "committees"). */

import { useSelectedDistrict } from "@/contexts/AuthContext";
import CommitteesWorkspace from "@/components/committees/CommitteesWorkspace";

export default function DistrictCommitteesPage() {
  const district = useSelectedDistrict();
  if (!district) return <p className="text-sm text-slate-500">No district selected.</p>;
  return <CommitteesWorkspace kind="district" scopeId={district.id} />;
}
