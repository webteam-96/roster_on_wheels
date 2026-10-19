"use client";

import { useEffect, useState } from "react";
import { getClubRecipientInfo, getDistrictRecipientInfo, getRiDirectorRecipientCount } from "@/services/api";

// Recipient / credit estimate next to the email checkbox: how many email credits a send will use and how many
// are available. Email is the only outbound channel.
type Props =
  | { scope: "club"; clubId: number; visible?: boolean; reminderCount?: number }
  | { scope: "district"; districtId: number; visible?: boolean; reminderCount?: number }
  | {
      scope: "ri";
      target: string;
      zoneIds?: number[];
      districtIds?: number[];
      subgroupIds?: number[];
      visible?: boolean;
      reminderCount?: number;
    };

export default function RecipientBadge(props: Props) {
  const [count, setCount] = useState<number | null>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (props.scope === "club" || props.scope === "district") {
          const info = props.scope === "club"
            ? await getClubRecipientInfo(props.clubId)
            : await getDistrictRecipientInfo(props.districtId);
          if (!cancelled) {
            setCount(info.emailRecipientCount);
            setAvailable(info.emailRemaining);
          }
        } else {
          const c = await getRiDirectorRecipientCount("email", (props.target as any) || "all",
            props.zoneIds, props.districtIds, props.subgroupIds);
          if (!cancelled) {
            setCount(c ?? 0);
            setAvailable(null);
          }
        }
      } catch {
        // the estimate is advisory; the send itself checks credits
      }
    })();
    return () => { cancelled = true; };
  }, [
    props.scope,
    (props as any).clubId,
    (props as any).districtId,
    (props as any).target,
    JSON.stringify((props as any).zoneIds ?? []),
    JSON.stringify((props as any).districtIds ?? []),
    JSON.stringify((props as any).subgroupIds ?? []),
  ]);

  if (count == null) return null;
  const sends = 1 + ((props as any).reminderCount ?? 0);
  const totalNeeded = count * sends;
  const insufficient = available != null && totalNeeded > available;

  return (
    <span className="ml-2 text-xs text-gray-600">
      (Will use <strong>{totalNeeded}</strong> email credit{totalNeeded === 1 ? "" : "s"}
      {", "}{count} member{count === 1 ? "" : "s"} × {sends} send{sends === 1 ? "" : "s"}
      {available != null && (
        <>
          {" · "}
          <span className={insufficient ? "text-red-600 font-semibold" : ""}>{available} available</span>
        </>
      )}
      {insufficient && <span className="text-red-600 font-semibold">: insufficient!</span>})
    </span>
  );
}
