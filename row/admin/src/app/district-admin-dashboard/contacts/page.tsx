"use client";

// District Admin · Contacts, groups, imports and event invites (feature contacts_growth).

import { useAuth } from "@/contexts/AuthContext";
import ContactsManager from "@/components/contacts/ContactsManager";

export default function DistrictContactsPage() {
  const { selectedDistrictId } = useAuth();
  if (!selectedDistrictId) return null;
  return <ContactsManager scope="districts" ownerId={selectedDistrictId} />;
}
