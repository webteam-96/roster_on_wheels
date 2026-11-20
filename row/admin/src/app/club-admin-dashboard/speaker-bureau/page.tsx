"use client";

/**
 * Club Admin Dashboard › Speaker bureau (flagged module "volunteers"). Find a speaker in the district's bureau by
 * topic, language, online / in person and rating; book them for a meeting (they go on the club's speakers list too);
 * rate the talk once it took place; propose a new speaker to the district.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { EntryForm, EntryTable, ProfilePanel, SearchFilters, SELECT } from "@/components/speakerBureau/BureauParts";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat, useToday } from "@/hooks/useFormat";
import {
  bookBureauSpeaker, cancelBureauBooking, findBureauSpeakers, getBureauBookings, getClubBureauProfile, proposeBureauSpeaker,
  rateBureauSpeaker,
} from "@/services/api";
import { blankBureauEntry, cleanBureauForm, tagList } from "@/lib/speakerBureau";
import type { BureauBooking, BureauEntry, BureauProfile, BureauSearch, SaveBureauEntry } from "@/types/speakerBureau";

const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

export default function ClubSpeakerBureauPage() {
  const { selectedClubId: clubId } = useAuth();
  const today = useToday();
  const [search, setSearch] = useState<BureauSearch>({});
  const [list, setList] = useState<BureauEntry[] | null>(null);
  const [bookings, setBookings] = useState<BureauBooking[] | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profile, setProfile] = useState<BureauProfile | null>(null);
  const [booking, setBooking] = useState<{ entry: BureauEntry; date: string } | null>(null);
  const [proposing, setProposing] = useState(false);
  const [form, setForm] = useState<SaveBureauEntry>(blankBureauEntry);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!clubId) return;
    setList(null);
    findBureauSpeakers(clubId, search)
      .then(setList)
      .catch((err) => { setList([]); setError(message(err, "Could not load the speaker bureau.")); });
  }, [clubId, search]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const loadBookings = useCallback(() => {
    if (!clubId) return;
    getBureauBookings(clubId)
      .then(setBookings)
      .catch((err) => { setBookings([]); setError(message(err, "Could not load your club's bookings.")); });
  }, [clubId]);
  useEffect(() => { setBookings(null); loadBookings(); }, [loadBookings]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;

  const open = (id: number) => {
    setProfileId(id);
    setProfile(null);
    getClubBureauProfile(clubId, id)
      .then(setProfile)
      .catch((err) => { setProfileId(null); setError(message(err, "Could not load the speaker.")); });
  };

  const book = async () => {
    if (!booking?.date) return;
    setBusy(true);
    try {
      await bookBureauSpeaker(clubId, booking.entry.id, booking.date);
      setNotice(`${booking.entry.name} is booked and added to your club's speakers.`);
      setBooking(null);
      loadBookings();
      load();
    } catch (err) {
      setError(message(err, "Could not book the speaker."));
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    setBusy(true);
    try {
      await proposeBureauSpeaker(clubId, cleanBureauForm(form));
      setForm(blankBureauEntry());
      setProposing(false);
      setNotice("Speaker proposed. The district lists them once it approves.");
    } catch (err) {
      setError(message(err, "Could not propose the speaker."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Speaker bureau</h2>
        <p className="text-base text-muted-foreground">
          Speakers your district recommends. Book one for a meeting, then rate the talk so other clubs can choose well.
        </p>
        {notice && <p className="mt-2 text-sm text-emerald-700" role="status">{notice}</p>}
      </div>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Find a speaker</h3>
        <SearchFilters value={search} onChange={setSearch} />
        <EntryTable list={list} empty="No speakers match. Try fewer filters, or propose a speaker to your district below."
          actions={(e) => (
            <>
              <Button variant="ghost" size="sm" onClick={() => open(e.id)}>Profile</Button>
              <Button variant="outline" size="sm" onClick={() => setBooking({ entry: e, date: "" })}>Book</Button>
            </>
          )} />
        {booking && (
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="sb-book-date">Meeting date for {booking.entry.name}</Label>
                <Input id="sb-book-date" type="date" required value={booking.date}
                  onChange={(e) => setBooking({ ...booking, date: e.target.value })} />
              </div>
              <Button disabled={busy || !booking.date} onClick={book} className="gap-1.5">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Book speaker
              </Button>
              <Button variant="outline" onClick={() => setBooking(null)}>Cancel</Button>
            </CardContent>
          </Card>
        )}
        {profileId && <ProfilePanel profile={profile} onClose={() => setProfileId(null)} />}
      </section>

      <BookingsSection clubId={clubId} today={today} bookings={bookings} onChanged={() => { loadBookings(); load(); }} onError={setError} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Propose a speaker</h3>
          {!proposing && <Button variant="outline" onClick={() => setProposing(true)}>Propose a speaker</Button>}
        </div>
        <p className="text-sm text-muted-foreground">
          Know a good speaker? Propose them to the district. You can also share a speaker from your club&apos;s speakers list.
        </p>
        {proposing && (
          <Card>
            <CardContent className="p-5">
              <EntryForm form={form} onChange={setForm} onSubmit={propose} onCancel={() => setProposing(false)} busy={busy}
                editing={false} submitLabel="Send to the district" />
            </CardContent>
          </Card>
        )}
      </section>

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function BookingsSection({ clubId, today, bookings, onChanged, onError }: {
  clubId: number; today: string; bookings: BureauBooking[] | null; onChanged: () => void; onError: (m: string) => void;
}) {
  const fmt = useFormat();
  const [rating, setRating] = useState<{ booking: BureauBooking; score: string; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const cancel = async (b: BureauBooking) => {
    if (!window.confirm(`Cancel the booking of ${b.name}? They come off your club's speakers list too.`)) return;
    try {
      await cancelBureauBooking(clubId, b.id);
      onChanged();
    } catch (err) {
      onError(message(err, "Could not cancel the booking."));
    }
  };

  const rate = async () => {
    if (!rating?.score) return;
    setBusy(true);
    try {
      await rateBureauSpeaker(clubId, rating.booking.entryId, {
        talkDate: rating.booking.talkDate.slice(0, 10), rating: Number(rating.score), comment: rating.comment.trim() || null,
      });
      setRating(null);
      onChanged();
    } catch (err) {
      onError(message(err, "Could not save the rating."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Your club&apos;s bookings</h3>
      {!bookings ? (
        <div aria-busy="true"><TableSkeleton rows={3} /></div>
      ) : bookings.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No speakers booked yet. Find one above and book them.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-[13px]">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Meeting</th>
                  <th className="p-3 font-medium">Speaker</th>
                  <th className="p-3 font-medium">Your rating</th>
                  <th className="p-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 align-top">
                    <td className="p-3 whitespace-nowrap">
                      {fmt.date(b.talkDate.slice(0, 10))}
                      {b.talkDate.slice(0, 10) >= today && <p className="text-xs text-muted-foreground">Coming</p>}
                    </td>
                    <td className="p-3">
                      <p className="font-medium">{b.name}</p>
                      <p className="text-muted-foreground">{tagList(b.topics).join(", ")}</p>
                    </td>
                    <td className="p-3">
                      {b.rating != null ? (
                        <>
                          <p>{b.rating} of 5</p>
                          {b.comment && <p className="text-muted-foreground">{b.comment}</p>}
                        </>
                      ) : b.canRate ? "Not rated yet" : "After the talk"}
                    </td>
                    <td className="p-3 whitespace-nowrap text-right">
                      {b.canRate && (
                        <Button variant="outline" size="sm" onClick={() => setRating({ booking: b, score: "", comment: "" })}>Rate the talk</Button>
                      )}
                      {b.rating == null && (
                        <Button variant="ghost" size="sm" aria-label={`Cancel the booking of ${b.name}`} onClick={() => cancel(b)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {rating && (
        <Card>
          <CardContent className="grid gap-3 p-5 md:grid-cols-[180px_1fr]">
            <p className="font-medium md:col-span-2">
              Rate {rating.booking.name}, {fmt.date(rating.booking.talkDate.slice(0, 10))}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="sb-rate-score">Rating</Label>
              <select id="sb-rate-score" className={SELECT} value={rating.score} onChange={(e) => setRating({ ...rating, score: e.target.value })}>
                <option value="">Choose</option>
                <option value="5">5, excellent</option>
                <option value="4">4, good</option>
                <option value="3">3, fair</option>
                <option value="2">2, weak</option>
                <option value="1">1, poor</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sb-rate-comment">Comment for other clubs (optional)</Label>
              <Textarea id="sb-rate-comment" rows={2} maxLength={500} value={rating.comment}
                onChange={(e) => setRating({ ...rating, comment: e.target.value })} />
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button disabled={busy || !rating.score} onClick={rate} className="gap-1.5">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rating
              </Button>
              <Button variant="outline" onClick={() => setRating(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
