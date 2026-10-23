"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { PlanningRole } from "@/types/planning";

/** A titled block of the planning workspace. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const PILL: Record<string, string> = {
  done: "border-green-300 bg-green-50 text-green-800",
  open: "border-border bg-background text-muted-foreground",
  stub: "border-dashed border-border bg-background text-muted-foreground",
};

/** A small status label: done, open, or not available yet. */
export function Pill({ kind, children }: { kind: "done" | "open" | "stub"; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-xs font-medium ${PILL[kind]}`}>{children}</span>;
}

/** A role holder: the member's name and whether the invitation is still pending. */
export function RoleHolder({ role }: { role: PlanningRole | null }) {
  if (!role) return <span className="text-muted-foreground">Not invited</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{role.memberName ?? `Member ${role.memberId}`}</span>
      {role.status === "invited" ? <Pill kind="open">Invited</Pill> : role.source === "ri" ? <Pill kind="done">From RI</Pill> : null}
    </span>
  );
}

export const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
