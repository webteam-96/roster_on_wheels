"use client";

/** Club Admin Dashboard › Committees: subcommittee tree, private documents and committee email (flag "committees"). */

import { useSelectedClub } from "@/contexts/AuthContext";
import CommitteesWorkspace from "@/components/committees/CommitteesWorkspace";

export default function ClubCommitteesPage() {
  const club = useSelectedClub();
  if (!club) return <p className="text-sm text-slate-500">No club selected.</p>;
  return <CommitteesWorkspace kind="club" scopeId={club.id} />;
}
