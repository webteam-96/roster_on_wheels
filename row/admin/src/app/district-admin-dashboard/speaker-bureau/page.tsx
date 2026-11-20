"use client";

/**
 * District Admin Dashboard › Speaker bureau (flagged module "volunteers"). The district's list of speakers that its
 * clubs can book: add and edit speakers, approve or reject the ones clubs propose, upload a photo, read the clubs'
 * ratings and hide an abusive comment (the score still counts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorAlert from "@/components/ErrorAlert";
import { EntryForm, EntryTable, ProfilePanel, SearchFilters } from "@/components/speakerBureau/BureauParts";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteBureauEntry, getDistrictBureau, getDistrictBureauProfile, hideBureauComment, saveDistrictBureauEntry,
  setBureauEntryStatus, uploadBureauPhoto,
} from "@/services/api";
import { blankBureauEntry, cleanBureauForm, toBureauForm } from "@/lib/speakerBureau";
import type { BureauEntry, BureauProfile, BureauSearch, BureauStatus, SaveBureauEntry } from "@/types/speakerBureau";

const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

export default function DistrictSpeakerBureauPage() {
  const { selectedDistrictId: districtId } = useAuth();
  const [search, setSearch] = useState<BureauSearch>({ status: "" });
  const [list, setList] = useState<BureauEntry[] | null>(null);
  const [form, setForm] = useState<SaveBureauEntry>(blankBureauEntry);
  const [editing, setEditing] = useState<number | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profile, setProfile] = useState<BureauProfile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!districtId) return;
    setList(null);
    getDistrictBureau(districtId, search)
      .then(setList)
      .catch((err) => { setList([]); setError(message(err, "Could not load the speaker bureau.")); });
  }, [districtId, search]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const loadProfile = useCallback((id: number) => {
    if (!districtId) return;
    setProfileId(id);
    setProfile(null);
    getDistrictBureauProfile(districtId, id)
      .then(setProfile)
      .catch((err) => { setProfileId(null); setError(message(err, "Could not load the speaker.")); });
  }, [districtId]);

  if (!districtId) return <p className="p-6 text-sm text-muted-foreground">Choose a district first.</p>;

  const reset = () => {
    setEditing(null);
    setForm(blankBureauEntry());
    setPhoto(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveDistrictBureauEntry(districtId, cleanBureauForm(form), editing ?? undefined);
      if (photo) await uploadBureauPhoto(districtId, saved.id, photo);
      reset();
      setNotice("Speaker saved.");
      load();
    } catch (err) {
      setError(message(err, "Could not save the speaker."));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (e: BureauEntry, status: BureauStatus) => {
    try {
      await setBureauEntryStatus(districtId, e.id, status);
      load();
    } catch (err) {
      setError(message(err, "Could not change the status."));
    }
  };

  const remove = async (e: BureauEntry) => {
    if (!window.confirm(`Remove ${e.name} from the speaker bureau? Their ratings go too.`)) return;
    try {
      await deleteBureauEntry(districtId, e.id);
      if (editing === e.id) reset();
      if (profileId === e.id) setProfileId(null);
      load();
    } catch (err) {
      setError(message(err, "Could not remove the speaker."));
    }
  };

  const hide = async (ratingId: number, hidden: boolean) => {
    try {
      await hideBureauComment(districtId, ratingId, hidden);
      if (profileId) loadProfile(profileId);
    } catch (err) {
      setError(message(err, "Could not change the comment."));
    }
  };

  return (
    <div className="space-y-8 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">Speaker bureau</h2>
        <p className="text-base text-muted-foreground">
          Speakers your clubs can book for their meetings. Clubs find them by topic, language and rating, book them, and
          rate the talk afterwards. Speakers proposed by clubs wait here for your approval.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">{editing ? "Edit speaker" : "Add a speaker"}</h3>
        <Card>
          <CardContent className="p-5">
            <EntryForm form={form} onChange={setForm} onSubmit={save} onCancel={editing ? reset : undefined} busy={busy}
              editing={!!editing} submitLabel={editing ? "Save speaker" : "Add speaker"}
              extra={
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="sb-photo">Photo (JPG, PNG or WebP, up to 5 MB)</Label>
                  <Input id="sb-photo" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                </div>
              } />
            {notice && <p className="mt-3 text-sm text-emerald-700" role="status">{notice}</p>}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Speakers</h3>
        <SearchFilters value={search} onChange={setSearch} withStatus />
        <EntryTable list={list} showStatus empty="No speakers match. Add one above, or clear the filters."
          actions={(e) => (
            <>
              <Button variant="ghost" size="sm" onClick={() => loadProfile(e.id)}>Ratings</Button>
              {e.status !== "approved" && (
                <Button variant="ghost" size="sm" aria-label={`Approve ${e.name}`} onClick={() => setStatus(e, "approved")}>
                  <Check className="h-4 w-4" />
                </Button>
              )}
              {e.status !== "rejected" && (
                <Button variant="ghost" size="sm" aria-label={`Reject ${e.name}`} onClick={() => setStatus(e, "rejected")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" aria-label={`Edit ${e.name}`}
                onClick={() => { setEditing(e.id); setForm(toBureauForm(e)); setPhoto(null); }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Remove ${e.name}`} onClick={() => remove(e)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )} />
        {profileId && <ProfilePanel profile={profile} onClose={() => setProfileId(null)} onHide={hide} />}
      </section>

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
