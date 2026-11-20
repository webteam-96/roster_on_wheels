"use client";

// Club Admin · Member lists: tags, custom profile fields and smart lists (member flexibility).

import { useAuth } from "@/contexts/AuthContext";
import MemberListsManager from "@/components/member-flex/MemberListsManager";

export default function ClubMemberListsPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  return <MemberListsManager clubId={selectedClubId} />;
}
