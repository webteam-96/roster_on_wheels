"use client";

/**
 * Club Admin Dashboard › Privacy: the club's former members (no active membership
 * anywhere) and one-click GDPR erasure with a preview and typed confirmation.
 * Shown when the instance sets privacy.enabled (ROW); the server re-checks every rule.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EraseMemberDialog from "@/components/privacy/EraseMemberDialog";
import { useSelectedClub } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import { getErrorMessage } from "@/lib/errors";
import { getClubFormerMembers } from "@/services/api";
import type { FormerMember } from "@/types/privacy";

export default function ClubPrivacyPage() {
  const club = useSelectedClub();
  const t = useTranslations("privacy.former");
  const tErase = useTranslations("privacy.erase");
  const tRoot = useTranslations();
  const fmt = useFormat();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<FormerMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [erasing, setErasing] = useState<number | null>(null);
  const clubId = club?.id ?? null;

  const load = useCallback(
    async (q: string) => {
      if (!clubId) return;
      setRows(null);
      setError(null);
      try {
        setRows(await getClubFormerMembers(clubId, q.trim() || undefined));
      } catch (e) {
        setRows([]);
        setError(getErrorMessage(e, tRoot));
      }
    },
    [clubId, tRoot],
  );

  useEffect(() => {
    const timer = setTimeout(() => load(query), 300);
    return () => clearTimeout(timer);
  }, [load, query]);

  if (!clubId) return <p className="p-6 text-sm text-slate-500">{t("noClub")}</p>;

  return (
    <div className="space-y-5 p-6">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-slate-900">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("intro")}</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" value={query} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      {rows === null ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        !error && <div className="rounded-[20px] border border-dashed bg-white p-8 text-center text-sm text-slate-600">{t("empty")}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.leftOn")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell className="font-medium text-slate-900">{r.name}</TableCell>
                  <TableCell>{r.leftOn ? fmt.date(r.leftOn) : <span className="text-slate-500">{t("unknownDate")}</span>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="gap-1.5 text-red-700" onClick={() => setErasing(r.memberId)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("erase")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EraseMemberDialog
        memberId={erasing}
        onOpenChange={(o) => !o && setErasing(null)}
        onDone={(r) => {
          setNotice(r.status === "awaiting_approval" ? tErase("awaiting") : tErase("done"));
          setRows((list) => (list ?? []).filter((x) => x.memberId !== r.memberId));
        }}
      />
    </div>
  );
}
