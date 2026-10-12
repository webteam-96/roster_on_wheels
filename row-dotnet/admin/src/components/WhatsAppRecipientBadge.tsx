"use client";

import { useEffect, useState } from "react";
import {
  getClubWhatsAppInfo,
  getDistrictWhatsAppInfo,
  getRiDirectorRecipientCount,
} from "@/services/api";

// Channel-aware recipient/credit estimate badge. Shows how many credits a send will
// use and how many are available, for either WhatsApp or Email. The email count is
// members with a valid email; the WhatsApp count is members with a mobile — the two
// can differ, so each channel's checkbox must render its OWN badge (channel prop).
type Channel = "whatsapp" | "email";

type Props =
  | { scope: "club"; clubId: number; visible?: boolean; reminderCount?: number; channel?: Channel }
  | { scope: "district"; districtId: number; visible?: boolean; reminderCount?: number; channel?: Channel }
  | {
      scope: "ri";
      target: string;
      zoneIds?: number[];
      districtIds?: number[];
      subgroupIds?: number[];
      visible?: boolean;
      reminderCount?: number;
      channel?: Channel;
    };

export default function WhatsAppRecipientBadge(props: Props) {
  const channel: Channel = (props as any).channel ?? "whatsapp";
  const [count, setCount] = useState<number | null>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (props.scope === "club") {
          const info = await getClubWhatsAppInfo(props.clubId);
          if (!cancelled) {
            setCount(channel === "email" ? info.emailRecipientCount : info.recipientCount);
            setAvailable(channel === "email" ? info.emailRemaining : info.whatsAppRemaining);
          }
        } else if (props.scope === "district") {
          const info = await getDistrictWhatsAppInfo(props.districtId);
          if (!cancelled) {
            setCount(channel === "email" ? info.emailRecipientCount : info.recipientCount);
            setAvailable(channel === "email" ? info.emailRemaining : info.whatsAppRemaining);
          }
        } else {
          const c = await getRiDirectorRecipientCount(
            channel,
            (props.target as any) || "all",
            props.zoneIds, props.districtIds, props.subgroupIds
          );
          if (!cancelled) {
            setCount(c ?? 0);
            setAvailable(null);
          }
        }
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, [
    channel,
    props.scope,
    (props as any).clubId,
    (props as any).districtId,
    (props as any).target,
    JSON.stringify((props as any).zoneIds ?? []),
    JSON.stringify((props as any).districtIds ?? []),
    JSON.stringify((props as any).subgroupIds ?? []),
  ]);

  if (count == null) return null;
  const reminderCount = (props as any).reminderCount ?? 0;
  const sends = 1 + reminderCount;
  const totalNeeded = count * sends;
  const insufficient = available != null && totalNeeded > available;
  const creditWord = channel === "email" ? "email credit" : "credit";

  return (
    <span className="ml-2 text-xs text-gray-600">
      (Will use <strong>{totalNeeded}</strong> {creditWord}{totalNeeded === 1 ? "" : "s"}
      {" "}— {count} member{count === 1 ? "" : "s"} × {sends} send{sends === 1 ? "" : "s"}
      {available != null && (
        <>
          {" · "}
          <span className={insufficient ? "text-red-600 font-semibold" : ""}>
            {available} available
          </span>
        </>
      )}
      {insufficient && <span className="text-red-600 font-semibold"> — insufficient!</span>})
    </span>
  );
}
