"use client";

// Opened by clicking a member's NAME on a screen that only knows their id — shows who that person is
// without leaving the page: photo, name, contacts, and every club they belong to with its district
// and zone. Deliberately small; MemberDetailDialog is the full profile (addresses, family, social).

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getGlobalMemberCard, getPhotoUrl, MemberCard } from "@/services/api";
import { User, Mail, Phone, Building2, IdCard } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";

export default function MemberContactCardDialog({
  memberId, open, onClose,
}: { memberId: number | null; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<MemberCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !memberId) { setData(null); setError(null); return; }
    setLoading(true);
    setError(null);
    getGlobalMemberCard(memberId)
      .then(setData)
      .catch((e: any) => setError(e?.response?.data?.message || "Failed to load member details."))
      .finally(() => setLoading(false));
  }, [open, memberId]);

  const m = data?.member;
  const photo = m?.profilePhoto ? getPhotoUrl(m.profilePhoto) : "";
  // Districts the member sits in, taken from their clubs — a district appears once even when they
  // belong to two clubs inside it.
  const districts = Array.from(
    new Set((data?.clubs || []).map((c) => c.districtNumber).filter(Boolean) as string[])
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Member</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
        ) : error || !m ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{error || "Member not found."}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-primary/10 border">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={m.memberName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-primary"><User className="h-8 w-8" /></div>
                )}
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-lg font-bold text-primary break-words">{m.memberName}</p>
                <div className="flex flex-wrap gap-1">
                  {m.rotaryId && (
                    <Badge variant="secondary" className="text-xs"><IdCard className="mr-1 h-3 w-3" />{m.rotaryId}</Badge>
                  )}
                  {districts.map((d) => (
                    <Badge key={d} variant="outline" className="text-xs">District {d}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="flex items-center gap-2 break-all">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                {m.email ? <a href={`mailto:${m.email}`} className="text-primary hover:underline">{m.email}</a>
                         : <span className="text-muted-foreground">No email</span>}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                {m.mobile ? (
                  <a href={`tel:${m.mobile}`} className="text-primary hover:underline">
                    {[m.mobileCode, m.mobile].filter(Boolean).join(" ")}
                  </a>
                ) : <span className="text-muted-foreground">No mobile</span>}
                {m.secondaryMobile && <span className="text-muted-foreground">· {m.secondaryMobile}</span>}
              </p>
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Clubs &amp; Districts
              </p>
              {(data?.clubs?.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  Not a member of any club.
                </p>
              ) : (
                data!.clubs.map((c) => {
                  const inactive = !(c.isActive === true || c.isActive === 1);
                  return (
                    <div key={c.clubId} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.clubName}</span>
                        {inactive && <Badge variant="destructive" className="text-xs">Past member</Badge>}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {c.districtNumber && <Badge variant="secondary" className="text-xs">D {c.districtNumber}</Badge>}
                        {c.zoneName && <Badge variant="outline" className="text-xs">{c.zoneName}</Badge>}
                        {[c.city, c.state].filter(Boolean).join(", ")}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
