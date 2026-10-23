"use client";

/**
 * Guest RSVP behind a member's personal invite link (feature contacts_growth, spec B.4 #33). Public, no sign-in.
 * A guest who wants to join becomes a prospect of the club; any other guest becomes a contact. Bare route
 * (RootShell): its own header and footer.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPublicInvite, sendInviteRsvp, type PublicInvite } from "@/services/api";
import { errorText } from "@/lib/contacts";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, MapPin } from "@/components/icons";

const when = (i: PublicInvite) => {
  const time = i.meetingFromTime ? `${i.meetingFromTime}${i.meetingToTime ? ` to ${i.meetingToTime}` : ""}` : "";
  if (i.meetingDate) {
    const d = new Date(`${i.meetingDate.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return time ? `${d}, ${time}` : d;
  }
  return i.meetingDay ? `Every ${i.meetingDay}${time ? `, ${time}` : ""}` : null;
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<PublicInvite | null | undefined>(undefined);
  const [form, setForm] = useState({ name: "", email: "", phone: "", attending: true, interestedInJoining: false, consent: false, website: "" });
  const [shownAt] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPublicInvite(token).then(setInvite).catch(() => setInvite(null));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() && !form.phone.trim()) { setError("Please give an email or a phone number."); return; }
    setSending(true);
    setError(null);
    try {
      await sendInviteRsvp(token, { ...form, elapsedMs: Date.now() - shownAt });
      setDone(true);
    } catch (err) {
      setError(errorText(err, "Something went wrong. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const meeting = invite ? when(invite) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-xl items-center px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/row-logo.png" alt="ROW" className="h-10 object-contain" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        {invite === undefined ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
            <Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-40 w-full" />
          </div>
        ) : invite === null ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <h1 className="text-lg font-semibold text-slate-800">This invitation is not available</h1>
            <p className="mt-2 text-sm text-slate-500">The link may be mistyped, or the member is no longer in the club.</p>
          </div>
        ) : done ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <h1 className="text-lg font-semibold text-slate-800">Thank you</h1>
            <p className="mt-2 text-sm text-slate-600">{invite.clubName} will be in touch with you soon.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm text-slate-500">{invite.inviterName} invites you to a meeting of</p>
            <h1 className="mt-1 text-xl font-semibold text-slate-800">{invite.clubName}</h1>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              {meeting && <p className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-azure" />{meeting}</p>}
              {invite.meetingAddress && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-azure" />{invite.meetingAddress}</p>}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="rsvp-name">Your name *</Label>
                <Input id="rsvp-name" required maxLength={200} value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="rsvp-email">Email</Label>
                  <Input id="rsvp-email" type="email" maxLength={200} value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rsvp-phone">Phone</Label>
                  <Input id="rsvp-phone" type="tel" maxLength={20} value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" />
                </div>
              </div>
              {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website}
                onChange={(e) => set({ website: e.target.value })} className="absolute -left-[9999px] h-px w-px opacity-0" />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox checked={form.attending} onCheckedChange={(v) => set({ attending: v === true })} /> I plan to come to the meeting
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox checked={form.interestedInJoining} onCheckedChange={(v) => set({ interestedInJoining: v === true })} /> I would like to know about joining the club
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <Checkbox className="mt-0.5" checked={form.consent} onCheckedChange={(v) => set({ consent: v === true })} />
                <span>I agree that {invite.clubName} may keep these details to contact me about this meeting and about membership. They are not shared with anyone else.</span>
              </label>
              {error && <p className="text-sm text-rose-700">{error}</p>}
              <Button type="submit" disabled={sending || !form.consent || !form.name.trim()} className="w-full bg-azure text-white hover:bg-mint-ink">
                {sending ? "Sending" : "Send my reply"}
              </Button>
            </form>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-xl justify-center gap-6 px-4 py-4 text-xs text-slate-500">
          <a href="/terms-and-conditions" className="hover:text-slate-800">Terms of Service</a>
          <a href="/privacy-policy" className="hover:text-slate-800">Privacy Policy</a>
        </nav>
      </footer>
    </div>
  );
}
