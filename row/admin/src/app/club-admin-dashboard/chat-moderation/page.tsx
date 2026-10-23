"use client";

/**
 * Club Admin Dashboard › Chat Moderation: messages members reported in the club's chats (flag chat).
 */

import { useAuth } from "@/contexts/AuthContext";
import ChatModerationQueue from "@/components/ChatModerationQueue";

export default function ClubChatModerationPage() {
  const { selectedClubId } = useAuth();
  return <ChatModerationQueue scope="clubs" ownerId={selectedClubId ?? null} />;
}
