"use client";

// Clickable chips that insert a Club Dues email token ({{clubName}}, {{amountDue}}, …) at the
// cursor, so the admin never has to know or type the raw {{token}} syntax. The backend
// (ClubDuesService.ApplyEmailTokens) substitutes these at send time.

export interface EmailToken {
  token: string;   // e.g. "{{clubName}}"
  label: string;   // human label shown on the chip
}

// Tokens available in the RECEIPT ("thank you") email — figures come from the payment.
export const CLUB_DUES_RECEIPT_TOKENS: EmailToken[] = [
  { token: "{{officerName}}", label: "Officer name" },
  { token: "{{clubName}}", label: "Club name" },
  { token: "{{districtNumber}}", label: "District" },
  { token: "{{rotaryYear}}", label: "Year" },
  { token: "{{purpose}}", label: "Purpose" },
  { token: "{{membersCovered}}", label: "Members paid" },
  { token: "{{amountPaid}}", label: "Amount paid" },
];

// Tokens available in the REMINDER email — figures are the club's live pending amount.
export const CLUB_DUES_REMINDER_TOKENS: EmailToken[] = [
  { token: "{{officerName}}", label: "Officer name" },
  { token: "{{clubName}}", label: "Club name" },
  { token: "{{districtNumber}}", label: "District" },
  { token: "{{rotaryYear}}", label: "Year" },
  { token: "{{purpose}}", label: "Purpose" },
  { token: "{{memberCount}}", label: "Total members" },
  { token: "{{unpaidCount}}", label: "Members pending" },
  { token: "{{perMemberRate}}", label: "Rate / member" },
  { token: "{{amountDue}}", label: "Amount due" },
  // Note: a static "Pay Online" button is always added to reminders automatically — no token needed.
];

export default function EmailTokenChips({ tokens, onInsert }: { tokens: EmailToken[]; onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground mr-0.5">Insert:</span>
      {tokens.map((t) => (
        <button
          key={t.token}
          type="button"
          title={`Insert ${t.token}`}
          onClick={() => onInsert(t.token)}
          className="text-xs rounded-full border border-primary/30 bg-primary/5 text-primary px-2 py-0.5 hover:bg-primary/10 transition-colors"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
