"use client";

// Contact groups as mass email recipients (recipient type 4, feature contacts_growth).

import { useEffect, useState } from "react";
import Link from "next/link";
import { getContactGroups, type ContactGroup, type ContactScope } from "@/services/api";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Checkbox } from "@/components/ui/checkbox";

export default function ContactGroupPicker({ scope, ownerId, selected, onChange }: {
  scope: ContactScope; ownerId: number; selected: Set<number>; onChange: (next: Set<number>) => void;
}) {
  const [groups, setGroups] = useState<ContactGroup[] | null>(null);

  useEffect(() => {
    getContactGroups(scope, ownerId).then(setGroups).catch(() => setGroups([]));
  }, [scope, ownerId]);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  if (groups === null) return <Skeleton className="h-24 w-full" />;
  if (groups.length === 0) {
    const href = scope === "clubs" ? "/club-admin-dashboard/contacts" : "/district-admin-dashboard/contacts";
    return <p className="text-sm text-slate-500">No contact groups yet. Add them under <Link href={href} className="text-azure underline">Contacts</Link>.</p>;
  }
  return (
    <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
      {groups.map((g) => (
        <label key={g.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
          <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">{g.name}</p>
            <p className="text-xs text-slate-500">{g.contactCount} contacts</p>
          </div>
        </label>
      ))}
    </div>
  );
}
