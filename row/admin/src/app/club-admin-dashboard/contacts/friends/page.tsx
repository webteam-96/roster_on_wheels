"use client";

// Club Admin · Friends of the club: non-members who get club emails and event invites (feature contacts_growth).

import { useAuth } from "@/contexts/AuthContext";
import ContactsManager from "@/components/contacts/ContactsManager";

export default function ClubFriendsPage() {
  const { selectedClubId } = useAuth();
  if (!selectedClubId) return null;
  return <ContactsManager scope="clubs" ownerId={selectedClubId} friendsOnly />;
}
