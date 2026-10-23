"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface MemberOption { id: number; name: string; hint?: string; clubId?: number }

/** Type two letters, pick a member from the results. The search function decides whose members are offered. */
export default function MemberPicker({ id, search, value, onChange }: {
  id: string;
  search: (q: string) => Promise<MemberOption[]>;
  value: MemberOption | null;
  onChange: (m: MemberOption | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      searchRef.current(q.trim())
        .then((r) => { if (!cancelled) setResults(r.slice(0, 8)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border px-3 text-sm">
        <span className="truncate">{value.name}{value.hint ? <span className="text-muted-foreground">, {value.hint}</span> : null}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" autoComplete="off" />
      {q.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-background text-sm" role="listbox">
          {busy && results.length === 0 && <li className="px-3 py-2 text-muted-foreground">Searching</li>}
          {!busy && results.length === 0 && <li className="px-3 py-2 text-muted-foreground">No member found</li>}
          {results.map((m, i) => (
            <li key={`${m.id}-${i}`} role="option" aria-selected={false}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { onChange(m); setQ(""); }}>
                {m.name}{m.hint ? <span className="text-muted-foreground">, {m.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
