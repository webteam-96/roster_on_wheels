import { appLocale } from "@/lib/appFormat";
// Browser drafts for the NEW Club Dues / District Dues wizards (user 2026-11-16).
// Every "Next" keeps what was typed so far in this browser, so an error, refresh or closed tab
// doesn't lose the steps already filled. Nothing goes to the database until the final Save;
// after a successful Save the draft is removed. Images can't be kept (browser limit) - they are
// picked again. Drafts are per logged-in member and per browser.

export type DuesDraftKind = "club" | "district";

export interface DuesDraft {
  id: string;
  kind: DuesDraftKind;
  memberId: number;
  savedAt: string; // ISO
  step: number;
  title: string; // e.g. "RC Thane City View · 2026-27 · Annual dues"
  data: Record<string, any>;
}

const KEY = "rotary:duesDrafts:v1";

function readAll(): DuesDraft[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeAll(list: DuesDraft[]) {
  try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full / blocked */ }
}

export function newDuesDraftId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function listDuesDrafts(kind: DuesDraftKind, memberId: number | undefined): DuesDraft[] {
  if (!memberId) return [];
  return readAll()
    .filter((d) => d.kind === kind && d.memberId === memberId)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function getDuesDraft(id: string | null, memberId: number | undefined): DuesDraft | null {
  if (!id || !memberId) return null;
  return readAll().find((d) => d.id === id && d.memberId === memberId) ?? null;
}

export function saveDuesDraft(draft: Omit<DuesDraft, "savedAt">) {
  const list = readAll().filter((d) => d.id !== draft.id);
  list.push({ ...draft, savedAt: new Date().toISOString() });
  writeAll(list);
}

export function deleteDuesDraft(id: string | null) {
  if (!id) return;
  writeAll(readAll().filter((d) => d.id !== id));
}

export function formatDraftTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
