"use client";

/**
 * District Admin Dashboard › Chat Moderation: messages members reported in the district's groups (flag chat).
 * Club chats are moderated by each club's admins.
 */

import { useAuth } from "@/contexts/AuthContext";
import ChatModerationQueue from "@/components/ChatModerationQueue";

export default function DistrictChatModerationPage() {
  const { selectedDistrictId } = useAuth();
  return <ChatModerationQueue scope="districts" ownerId={selectedDistrictId ?? null} />;
}
