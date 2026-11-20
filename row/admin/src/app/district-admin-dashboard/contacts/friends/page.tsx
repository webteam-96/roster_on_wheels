"use client";

// District Admin · Friends of the district: non-members who get district emails and event invites (feature contacts_growth).

import { useAuth } from "@/contexts/AuthContext";
import ContactsManager from "@/components/contacts/ContactsManager";

export default function DistrictFriendsPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return <ContactsManager scope="districts" ownerId={selectedDistrictId} friendsOnly />;
}
