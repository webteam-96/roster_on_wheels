"use client";

// Unsaved Club Dues / District Dues drafts kept in this browser (see lib/duesDraft.ts),
// shown above the dues list with Continue / Discard. Renders nothing when there are none.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { DuesDraft, DuesDraftKind, deleteDuesDraft, formatDraftTime, listDuesDrafts } from "@/lib/duesDraft";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileClock, Trash2, ArrowRight } from "@/components/icons";

export default function DuesDraftsCard({ kind, stepLabels }: { kind: DuesDraftKind; stepLabels: string[] }) {
  const { user } = useAuth();
  const router = useRouter();
  const [drafts, setDrafts] = useState<DuesDraft[]>([]);

  useEffect(() => { setDrafts(listDuesDrafts(kind, user?.memberId)); }, [kind, user?.memberId]);

  if (drafts.length === 0) return null;
  const base = kind === "club" ? "/settings/membership-dues/create" : "/settings/club-dues/create";

  return (
    <Card className="border-amber-300 bg-amber-50/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-900">
          <FileClock className="h-4 w-4" /> Drafts not saved yet
          <span className="text-xs font-normal text-amber-800">(kept in this browser only · saved to the system after the last step)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2">
            <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Draft</Badge>
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium text-sm">{d.title || "Untitled"}</div>
              <div className="text-xs text-muted-foreground">
                Stopped at step {d.step + 1}{stepLabels[d.step] ? ` – ${stepLabels[d.step]}` : ""} · {formatDraftTime(d.savedAt)}
              </div>
            </div>
            <Button size="sm" onClick={() => router.push(`${base}?draft=${d.id}`)}>
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600"
              onClick={() => {
                if (!window.confirm(`Discard the draft "${d.title || "Untitled"}"? This cannot be undone.`)) return;
                deleteDuesDraft(d.id);
                setDrafts(listDuesDrafts(kind, user?.memberId));
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Discard
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
