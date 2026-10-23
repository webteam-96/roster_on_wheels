"use client";

// Club Admin · Contacts, groups, imports, event invites and guest invite prompts (feature contacts_growth).

import { useAuth } from "@/contexts/AuthContext";
import ContactsManager from "@/components/contacts/ContactsManager";

export default function ClubContactsPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  return <ContactsManager scope="clubs" ownerId={selectedClubId} />;
}
