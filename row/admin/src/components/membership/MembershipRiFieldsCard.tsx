"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { getMembershipRiFields, getRiCodes, setMembershipRiFields, type RiCode } from "@/services/api";

const SELECT = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * A membership's RI member type and join reason (build spec 3.12), for the Rotary.org outbound sync. Shown on the
 * member edit page when it is opened from a club (?clubId=). The termination reason is picked when removing.
 */
export function MembershipRiFieldsCard({ clubId, memberId }: { clubId: number; memberId: number }) {
  const [codes, setCodes] = useState<RiCode[] | null>(null);
  const [type, setType] = useState("");
  const [join, setJoin] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let live = true;
    Promise.all([getRiCodes(), getMembershipRiFields(clubId, memberId)])
      .then(([c, f]) => {
        if (!live) return;
        setCodes(c);
        setType(f.riMemberType ?? "");
        setJoin(f.joinReasonCode ?? "");
      })
      .catch(() => live && setCodes([]));
    return () => { live = false; };
  }, [clubId, memberId]);

  const save = async () => {
    setState("saving");
    try {
      await setMembershipRiFields(clubId, memberId, { riMemberType: type || null, joinReasonCode: join || null });
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const types = codes?.filter((c) => c.kind === "member_type") ?? [];
  const joins = codes?.filter((c) => c.kind === "join_reason") ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">RI membership fields</CardTitle>
        <p className="text-sm text-muted-foreground">Reported to Rotary International once the Rotary.org sync is connected.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {codes === null ? (
          <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ri-type">RI member type</Label>
                <select id="ri-type" className={SELECT} value={type} onChange={(e) => { setType(e.target.value); setState("idle"); }}>
                  <option value="">Not set</option>
                  {types.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ri-join">Join reason</Label>
                <select id="ri-join" className={SELECT} value={join} onChange={(e) => { setJoin(e.target.value); setState("idle"); }}
                  disabled={joins.length === 0}>
                  <option value="">{joins.length === 0 ? "No join reasons in Settings > RI codes" : "Not set"}</option>
                  {joins.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving..." : "Save RI fields"}</Button>
              <span role="status" className="text-sm text-muted-foreground">
                {state === "saved" ? "Saved." : state === "error" ? "Could not save. Is the member still in this club?" : ""}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
