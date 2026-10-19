"use client";

// Compact per-broadcast delivery status for listing rows (announcements, events, newsletters,
// projects). For each enabled channel shows: "Pending" (queued / mid-throttle send, SentDate
// still null) or "✓ {sent} · ✗ {failed}" once the send has finished. Renders nothing when
// neither channel is enabled.
import { Mail } from "@/components/icons";

export interface SendStatusItem {
  isSendEmail?: boolean;
  emailSentDate?: string | null;
  emailSentCount?: number;
  emailFailedCount?: number;
}

function ChannelChip({
  enabled, sentDate, sent, failed, Icon, title,
}: {
  enabled: boolean; sentDate?: string | null; sent?: number; failed?: number;
  Icon: typeof Mail; title: string;
}) {
  if (!enabled) return null;
  const pending = !sentDate;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
      title={title}
    >
      <Icon size={11} className="text-slate-400" />
      {pending ? (
        <span className="text-amber-600">Pending</span>
      ) : (
        <>
          <span className="text-emerald-600">✓ {sent ?? 0}</span>
          {(failed ?? 0) > 0 && <span className="text-red-600">✗ {failed}</span>}
        </>
      )}
    </span>
  );
}

export default function SendStatusBadges({ item, className }: { item: SendStatusItem; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      <ChannelChip
        enabled={!!item.isSendEmail} sentDate={item.emailSentDate}
        sent={item.emailSentCount} failed={item.emailFailedCount}
        Icon={Mail} title="Email: sent / failed (Pending until the send finishes)"
      />
    </div>
  );
}
