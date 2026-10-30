"use client";

/**
 * Attendance v2 — Add.
 *
 * Same data semantics as the v1 add page: every field (event details +
 * Members / Anns / Annets / Visitors / Rotarians / Delegates sub-records),
 * every API call, every validation rule preserved verbatim. Only the visual
 * presentation differs (V2FormShell wrapper, dot-accented section cards,
 * sticky save bar).
 *
 * v2 reads ONLY `?returnTo=` — no `returnUrl`, no `backUrl`.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  FileText, Users, UserPlus, UserCheck, Globe, Award,
  Plus, X, Pencil, Search,
} from "@/components/icons";
import {
  getClub,
  createAttendance,
  getClubMembersForAttendance,
} from "@/services/api";
import { ClubMemberSimple } from "@/types/attendance";
import V2FormShell, { useV2ReturnTo } from "@/components/v2/V2FormShell";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RotaryLoader from "@/components/RotaryLoader";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";

import { sanitizeText } from "@/lib/textInput";
import MeetingModeFields from "@/components/attendance/MeetingModeFields";
import { meetingPayload, validateMeeting, type MeetingMode } from "@/lib/meeting";
import { ListPageSkeleton } from "@/components/row/AppKit";

type AnnItem = { tempId: string; annName: string };
type AnnetItem = { tempId: string; annetName: string };
type VisitorItem = { tempId: string; visitorName: string; invitedBy: string };
type RotarianItem = { tempId: string; rotarianName: string; clubName: string };
type DelegateItem = { tempId: string; rotarianName: string; districtDesignation: string; clubName: string };

function genId() {
  return Math.random().toString(36).substring(2, 10);
}

function FieldLabel({ children, hint, dot, required = true }: { children: React.ReactNode; hint?: string; dot: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <label className="text-xs font-semibold text-slate-700">
        {children}{required && <span className="text-rose-600 ml-0.5">*</span>}
        {hint && <span className="text-slate-400 font-normal ml-1">{hint}</span>}
      </label>
    </div>
  );
}

function SectionCard({
  number, icon: Icon, title, dot, children,
}: { number: number; icon: React.ElementType; title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-white text-xs font-bold ${dot}`}>{number}</div>
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function CountTile({
  onClick, icon: Icon, label, count, accent,
}: { onClick: () => void; icon: React.ElementType; label: string; count: number; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 p-3 border rounded-lg hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer transition-colors w-full text-left`}
    >
      <Icon className={`h-5 w-5 ${accent}`} />
      <span className="font-medium text-sm flex-1 text-slate-700">{label}</span>
      <span className={`inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full text-xs font-bold ${accent.replace("text-", "bg-").replace("-600", "-100")} ${accent.replace("-600", "-700")}`}>
        {count}
      </span>
    </button>
  );
}

export default function AttendanceV2AddPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const clubId = Number(params.id);
  const { navigateAfterSave } = useV2ReturnTo(`/clubs/${clubId}/attendance/v2`);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Section 1: Event Details
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDateTime, setEventDateTime] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("in_person");
  const [meetingLink, setMeetingLink] = useState("");

  // Section 2: Sub-records
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [anns, setAnns]           = useState<AnnItem[]>([]);
  const [annets, setAnnets]       = useState<AnnetItem[]>([]);
  const [visitors, setVisitors]   = useState<VisitorItem[]>([]);
  const [rotarians, setRotarians] = useState<RotarianItem[]>([]);
  const [delegates, setDelegates] = useState<DelegateItem[]>([]);

  // Dialog open states
  const [membersDialogOpen, setMembersDialogOpen]     = useState(false);
  const [annsDialogOpen, setAnnsDialogOpen]           = useState(false);
  const [annetsDialogOpen, setAnnetsDialogOpen]       = useState(false);
  const [visitorsDialogOpen, setVisitorsDialogOpen]   = useState(false);
  const [rotariansDialogOpen, setRotariansDialogOpen] = useState(false);
  const [delegatesDialogOpen, setDelegatesDialogOpen] = useState(false);

  // Members data
  const [clubMembers, setClubMembers] = useState<ClubMemberSimple[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setErrorMessage(e?.response?.data?.message || "Failed to initialize.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  // Lazy-load club members the first time the dialog opens
  useEffect(() => {
    if (membersDialogOpen && clubMembers.length === 0) {
      setMembersLoading(true);
      getClubMembersForAttendance(clubId)
        .then((data) => setClubMembers(data))
        .catch(() => setErrorMessage("Failed to load club members."))
        .finally(() => setMembersLoading(false));
    }
  }, [membersDialogOpen, clubId, clubMembers.length]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return clubMembers;
    const q = memberSearch.toLowerCase();
    return clubMembers.filter((m) => m.memberName.toLowerCase().includes(q));
  }, [clubMembers, memberSearch]);

  // Clean rather than reject: text pasted from a web page or Word carries curly quotes and
  // dashes, and silently dropping the whole change made a paste look like it did nothing.
  const handleEventNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEventName(sanitizeText(e.target.value));
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(sanitizeText(e.target.value));
  };

  const toggleMember = (id: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAllMembers = () => {
    if (selectedMemberIds.length === clubMembers.length) {
      setSelectedMemberIds([]);
    } else {
      setSelectedMemberIds(clubMembers.map((m) => m.id));
    }
  };

  const handleSave = async () => {
    if (!eventName.trim()) { setErrorMessage("Event Name is required."); return; }
    if (eventName.trim().length > 500) { setErrorMessage("Event Name must be 500 characters or less."); return; }
    if (!description.trim()) { setErrorMessage("Description is required."); return; }
    if (description.trim().length > 10000) { setErrorMessage("Description must be 10000 characters or less."); return; }
    if (!eventDateTime) { setErrorMessage("Event Date & Time is required."); return; }
    const meetingError = validateMeeting(meetingMode, meetingLink);
    if (meetingError) { setErrorMessage(meetingError); return; }

    setSaving(true);
    try {
      await createAttendance(clubId, {
        eventName: eventName.trim(),
        description: description.trim(),
        eventDateTime: eventDateTime + ":00",
        ...meetingPayload(meetingMode, meetingLink),
        memberIds: selectedMemberIds,
        anns:    anns.map((a)   => ({ annName: a.annName })),
        annets:  annets.map((a) => ({ annetName: a.annetName })),
        visitors:  visitors.map((v)  => ({ visitorName: v.visitorName, invitedBy: v.invitedBy || null })),
        rotarians: rotarians.map((r) => ({ rotarianName: r.rotarianName, clubName: r.clubName || null })),
        delegates: delegates.map((d) => ({
          rotarianName: d.rotarianName,
          districtDesignation: d.districtDesignation || null,
          clubName: d.clubName || null,
        })),
      });
      setSuccessMessage("Attendance created successfully.");
      setShowSuccessDialog(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setErrorMessage(e?.response?.data?.message || "Failed to save attendance.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle="Mark Attendance"
        activeNavHref="/club-admin-dashboard/e-governance"
      >
      <V2FormShell
        title="Add Attendance"
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/attendance/v2`}
        saving={saving}
        saveLabel="Save Attendance"
        onSave={handleSave}
      >
        {/* 1. Event Details */}
        <SectionCard number={1} icon={FileText} title="Event Details" dot="bg-[#17458F]">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <FieldLabel hint="(max 500 chars)" dot="bg-[#17458F]">Event Name</FieldLabel>
              <input
                type="text"
                value={eventName}
                onChange={handleEventNameChange}
                placeholder="Event name"
                maxLength={500}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{eventName.length}/500</p>
            </div>
            <div>
              <FieldLabel hint="(max 10000 chars)" dot="bg-[#17458F]">Description</FieldLabel>
              <textarea
                value={description}
                onChange={handleDescriptionChange}
                placeholder="Describe the event…"
                rows={4}
                maxLength={10000}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/10000</p>
            </div>
            <div>
              <FieldLabel dot="bg-[#17458F]">Event Date &amp; Time</FieldLabel>
              <input
                type="datetime-local"
                value={eventDateTime}
                onChange={(e) => setEventDateTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-[12px] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#1B2C42]"
              />
            </div>
            <MeetingModeFields mode={meetingMode} link={meetingLink} onModeChange={setMeetingMode} onLinkChange={setMeetingLink} />
          </div>
        </SectionCard>

        {/* 2. Attendance Sub-records */}
        <SectionCard number={2} icon={Users} title="Attendance" dot="bg-[#17458F]">
          <p className="text-xs text-slate-500 mb-3">Click any tile to manage attendees of that category.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <CountTile onClick={() => setMembersDialogOpen(true)}   icon={Users}     label="Members"               count={selectedMemberIds.length} accent="text-blue-600" />
            <CountTile onClick={() => setAnnsDialogOpen(true)}      icon={UserPlus}  label="Anns"                  count={anns.length}              accent="text-green-600" />
            <CountTile onClick={() => setAnnetsDialogOpen(true)}    icon={UserPlus}  label="Annets"                count={annets.length}            accent="text-purple-600" />
            <CountTile onClick={() => setVisitorsDialogOpen(true)}  icon={UserCheck} label="Visitors"              count={visitors.length}          accent="text-amber-600" />
            <CountTile onClick={() => setRotariansDialogOpen(true)} icon={Globe}     label="Rotarians (Other Club)" count={rotarians.length}        accent="text-teal-600" />
            <CountTile onClick={() => setDelegatesDialogOpen(true)} icon={Award}     label="District Delegates"    count={delegates.length}         accent="text-rose-600" />
          </div>
        </SectionCard>

        {/* Dialogs */}
        <MembersDialog
          open={membersDialogOpen}
          onOpenChange={setMembersDialogOpen}
          loading={membersLoading}
          members={filteredMembers}
          allMembers={clubMembers}
          selectedIds={selectedMemberIds}
          search={memberSearch}
          onSearchChange={setMemberSearch}
          onToggle={toggleMember}
          onToggleAll={toggleAllMembers}
        />

        <SimpleListDialog
          open={annsDialogOpen}
          onOpenChange={setAnnsDialogOpen}
          title="Manage Anns"
          placeholder="Ann name"
          items={anns}
          nameKey="annName"
          onAdd={(name) => setAnns((prev) => [...prev, { tempId: genId(), annName: name }])}
          onUpdate={(tempId, name) => setAnns((prev) => prev.map((a) => a.tempId === tempId ? { ...a, annName: name } : a))}
          onRemove={(tempId) => setAnns((prev) => prev.filter((a) => a.tempId !== tempId))}
        />

        <SimpleListDialog
          open={annetsDialogOpen}
          onOpenChange={setAnnetsDialogOpen}
          title="Manage Annets"
          placeholder="Annet name"
          items={annets}
          nameKey="annetName"
          onAdd={(name) => setAnnets((prev) => [...prev, { tempId: genId(), annetName: name }])}
          onUpdate={(tempId, name) => setAnnets((prev) => prev.map((a) => a.tempId === tempId ? { ...a, annetName: name } : a))}
          onRemove={(tempId) => setAnnets((prev) => prev.filter((a) => a.tempId !== tempId))}
        />

        <VisitorsDialog
          open={visitorsDialogOpen}
          onOpenChange={setVisitorsDialogOpen}
          items={visitors}
          onAdd={(name, invitedBy) => setVisitors((prev) => [...prev, { tempId: genId(), visitorName: name, invitedBy }])}
          onUpdate={(tempId, name, invitedBy) => setVisitors((prev) => prev.map((v) => v.tempId === tempId ? { ...v, visitorName: name, invitedBy } : v))}
          onRemove={(tempId) => setVisitors((prev) => prev.filter((v) => v.tempId !== tempId))}
        />

        <RotariansDialog
          open={rotariansDialogOpen}
          onOpenChange={setRotariansDialogOpen}
          items={rotarians}
          onAdd={(name, club) => setRotarians((prev) => [...prev, { tempId: genId(), rotarianName: name, clubName: club }])}
          onUpdate={(tempId, name, club) => setRotarians((prev) => prev.map((r) => r.tempId === tempId ? { ...r, rotarianName: name, clubName: club } : r))}
          onRemove={(tempId) => setRotarians((prev) => prev.filter((r) => r.tempId !== tempId))}
        />

        <DelegatesDialog
          open={delegatesDialogOpen}
          onOpenChange={setDelegatesDialogOpen}
          items={delegates}
          onAdd={(name, designation, club) => setDelegates((prev) => [...prev, { tempId: genId(), rotarianName: name, districtDesignation: designation, clubName: club }])}
          onUpdate={(tempId, name, designation, club) => setDelegates((prev) => prev.map((d) => d.tempId === tempId ? { ...d, rotarianName: name, districtDesignation: designation, clubName: club } : d))}
          onRemove={(tempId) => setDelegates((prev) => prev.filter((d) => d.tempId !== tempId))}
        />

        <SuccessAlert
          open={showSuccessDialog}
          title="Saved"
          description={successMessage || "Attendance saved successfully."}
          onOk={() => { setShowSuccessDialog(false); setSuccessMessage(null); navigateAfterSave(); }}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>
      </ClubAdminShell>
    </ProtectedRoute>
  );
}

/* ═══════════════════════════════════════════════════════ */
/* Members Dialog                                         */
/* ═══════════════════════════════════════════════════════ */

function MembersDialog({
  open, onOpenChange, loading, members, allMembers, selectedIds, search, onSearchChange, onToggle, onToggleAll,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  members: ClubMemberSimple[];
  allMembers: ClubMemberSimple[];
  selectedIds: number[];
  search: string;
  onSearchChange: (v: string) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Members</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><RotaryLoader size="md" /></div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <label className="flex items-center gap-2 py-1 cursor-pointer border-b pb-2">
              <input
                type="checkbox"
                checked={allMembers.length > 0 && selectedIds.length === allMembers.length}
                onChange={onToggleAll}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Select All ({selectedIds.length}/{allMembers.length})</span>
            </label>
            <div className="flex-1 overflow-y-auto space-y-1 max-h-60">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 py-1.5 px-1 hover:bg-muted/50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(m.id)}
                    onChange={() => onToggle(m.id)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm">{m.memberName}</span>
                </label>
              ))}
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No members found.</p>
              )}
            </div>
          </>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════ */
/* Simple List Dialog (Anns / Annets)                     */
/* ═══════════════════════════════════════════════════════ */

function SimpleListDialog<T extends { tempId: string }>({
  open, onOpenChange, title, placeholder, items, nameKey, onAdd, onUpdate, onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  placeholder: string;
  items: T[];
  nameKey: string;
  onAdd: (name: string) => void;
  onUpdate: (tempId: string, name: string) => void;
  onRemove: (tempId: string) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInputValue("");
  };

  const startEdit = (item: T) => {
    setEditingId(item.tempId);
    setEditValue((item as Record<string, string>)[nameKey]);
  };

  const saveEdit = (tempId: string) => {
    const trimmed = editValue.trim();
    if (trimmed) onUpdate(tempId, trimmed);
    setEditingId(null);
    setEditValue("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="flex-1"
          />
          <Button onClick={handleAdd} size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 max-h-60">
          {items.map((item) => (
            <div key={item.tempId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
              {editingId === item.tempId ? (
                <>
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(item.tempId); }}
                    className="flex-1 h-8"
                    autoFocus
                  />
                  <Button variant="ghost" size="sm" onClick={() => saveEdit(item.tempId)}>Save</Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{(item as Record<string, string>)[nameKey]}</span>
                  <button onClick={() => startEdit(item)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onRemove(item.tempId)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No items added yet.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════ */
/* Visitors Dialog                                        */
/* ═══════════════════════════════════════════════════════ */

function VisitorsDialog({
  open, onOpenChange, items, onAdd, onUpdate, onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: VisitorItem[];
  onAdd: (name: string, invitedBy: string) => void;
  onUpdate: (tempId: string, name: string, invitedBy: string) => void;
  onRemove: (tempId: string) => void;
}) {
  const [nameVal, setNameVal] = useState("");
  const [invitedByVal, setInvitedByVal] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInvitedBy, setEditInvitedBy] = useState("");

  const handleAdd = () => {
    if (!nameVal.trim()) return;
    onAdd(nameVal.trim(), invitedByVal.trim());
    setNameVal("");
    setInvitedByVal("");
  };

  const startEdit = (item: VisitorItem) => {
    setEditingId(item.tempId);
    setEditName(item.visitorName);
    setEditInvitedBy(item.invitedBy);
  };

  const saveEdit = (tempId: string) => {
    if (editName.trim()) onUpdate(tempId, editName.trim(), editInvitedBy.trim());
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Visitors</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Visitor Name" value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="flex-1" />
          <Input placeholder="Invited By" value={invitedByVal} onChange={(e) => setInvitedByVal(e.target.value)} className="flex-1" />
          <Button onClick={handleAdd} size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 max-h-60">
          {items.map((item) => (
            <div key={item.tempId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
              {editingId === item.tempId ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 h-8" autoFocus />
                  <Input value={editInvitedBy} onChange={(e) => setEditInvitedBy(e.target.value)} className="flex-1 h-8" />
                  <Button variant="ghost" size="sm" onClick={() => saveEdit(item.tempId)}>Save</Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{item.visitorName}</span>
                  <span className="text-xs text-muted-foreground flex-1">{item.invitedBy && `Invited by: ${item.invitedBy}`}</span>
                  <button onClick={() => startEdit(item)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onRemove(item.tempId)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No visitors added yet.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════ */
/* Rotarians (Other Club) Dialog                          */
/* ═══════════════════════════════════════════════════════ */

function RotariansDialog({
  open, onOpenChange, items, onAdd, onUpdate, onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: RotarianItem[];
  onAdd: (name: string, club: string) => void;
  onUpdate: (tempId: string, name: string, club: string) => void;
  onRemove: (tempId: string) => void;
}) {
  const [nameVal, setNameVal] = useState("");
  const [clubVal, setClubVal] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editClub, setEditClub] = useState("");

  const handleAdd = () => {
    if (!nameVal.trim()) return;
    onAdd(nameVal.trim(), clubVal.trim());
    setNameVal("");
    setClubVal("");
  };

  const startEdit = (item: RotarianItem) => {
    setEditingId(item.tempId);
    setEditName(item.rotarianName);
    setEditClub(item.clubName);
  };

  const saveEdit = (tempId: string) => {
    if (editName.trim()) onUpdate(tempId, editName.trim(), editClub.trim());
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Rotarians (Other Club)</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Rotarian Name" value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="flex-1" />
          <Input placeholder="Club Name" value={clubVal} onChange={(e) => setClubVal(e.target.value)} className="flex-1" />
          <Button onClick={handleAdd} size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 max-h-60">
          {items.map((item) => (
            <div key={item.tempId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
              {editingId === item.tempId ? (
                <>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 h-8" autoFocus />
                  <Input value={editClub} onChange={(e) => setEditClub(e.target.value)} className="flex-1 h-8" />
                  <Button variant="ghost" size="sm" onClick={() => saveEdit(item.tempId)}>Save</Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1">{item.rotarianName}</span>
                  <span className="text-xs text-muted-foreground flex-1">{item.clubName && `Club: ${item.clubName}`}</span>
                  <button onClick={() => startEdit(item)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onRemove(item.tempId)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No rotarians added yet.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════ */
/* District Delegates Dialog                              */
/* ═══════════════════════════════════════════════════════ */

function DelegatesDialog({
  open, onOpenChange, items, onAdd, onUpdate, onRemove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: DelegateItem[];
  onAdd: (name: string, designation: string, club: string) => void;
  onUpdate: (tempId: string, name: string, designation: string, club: string) => void;
  onRemove: (tempId: string) => void;
}) {
  const [nameVal, setNameVal] = useState("");
  const [designationVal, setDesignationVal] = useState("");
  const [clubVal, setClubVal] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesignation, setEditDesignation] = useState("");
  const [editClub, setEditClub] = useState("");

  const handleAdd = () => {
    if (!nameVal.trim()) return;
    onAdd(nameVal.trim(), designationVal.trim(), clubVal.trim());
    setNameVal("");
    setDesignationVal("");
    setClubVal("");
  };

  const startEdit = (item: DelegateItem) => {
    setEditingId(item.tempId);
    setEditName(item.rotarianName);
    setEditDesignation(item.districtDesignation);
    setEditClub(item.clubName);
  };

  const saveEdit = (tempId: string) => {
    if (editName.trim()) onUpdate(tempId, editName.trim(), editDesignation.trim(), editClub.trim());
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage District Delegates</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Rotarian Name" value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="flex-1 min-w-[120px]" />
          <Input placeholder="District Designation" value={designationVal} onChange={(e) => setDesignationVal(e.target.value)} className="flex-1 min-w-[120px]" />
          <Input placeholder="Club Name" value={clubVal} onChange={(e) => setClubVal(e.target.value)} className="flex-1 min-w-[120px]" />
          <Button onClick={handleAdd} size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 max-h-60">
          {items.map((item) => (
            <div key={item.tempId} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
              {editingId === item.tempId ? (
                <div className="flex gap-2 flex-1 flex-wrap">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 h-8 min-w-[100px]" autoFocus />
                  <Input value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} className="flex-1 h-8 min-w-[100px]" />
                  <Input value={editClub} onChange={(e) => setEditClub(e.target.value)} className="flex-1 h-8 min-w-[100px]" />
                  <Button variant="ghost" size="sm" onClick={() => saveEdit(item.tempId)}>Save</Button>
                </div>
              ) : (
                <>
                  <span className="text-sm flex-1">{item.rotarianName}</span>
                  <span className="text-xs text-muted-foreground">{item.districtDesignation && `${item.districtDesignation}`}</span>
                  <span className="text-xs text-muted-foreground">{item.clubName && `(${item.clubName})`}</span>
                  <button onClick={() => startEdit(item)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onRemove(item.tempId)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No delegates added yet.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
