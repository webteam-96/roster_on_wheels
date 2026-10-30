"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getClub,
  getAttendance,
  updateAttendance,
  getClubMembersForAttendance,
} from "@/services/api";
import { ClubMemberSimple } from "@/types/attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import {
  ArrowLeft,
  FileText,
  Send,
  Users,
  UserPlus,
  UserCheck,
  Globe,
  Award,
  Plus,
  X,
  Pencil,
  Search,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

import { sanitizeText } from "@/lib/textInput";
import MeetingModeFields from "@/components/attendance/MeetingModeFields";
import { meetingPayload, validateMeeting, type MeetingMode } from "@/lib/meeting";
import { ListPageSkeleton } from "@/components/row/AppKit";

function Req({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <Label className="text-sm font-semibold text-foreground">
      {children}<span className="text-destructive ml-0.5">*</span>
      {hint && <span className="text-muted-foreground font-normal ml-1">{hint}</span>}
    </Label>
  );
}

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-[20px] border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

type AnnItem = { tempId: string; annName: string };
type AnnetItem = { tempId: string; annetName: string };
type VisitorItem = { tempId: string; visitorName: string; invitedBy: string };
type RotarianItem = { tempId: string; rotarianName: string; clubName: string };
type DelegateItem = { tempId: string; rotarianName: string; districtDesignation: string; clubName: string };

function genId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function AttendanceEditPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const attendanceId = Number(params.attendanceId);

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Section 1: Event Details
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDateTime, setEventDateTime] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("in_person");
  const [meetingLink, setMeetingLink] = useState("");

  // Track original event date to allow existing past dates
  const [originalEventDateTime, setOriginalEventDateTime] = useState("");

  // Section 2: Attendance sub-records
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [anns, setAnns] = useState<AnnItem[]>([]);
  const [annets, setAnnets] = useState<AnnetItem[]>([]);
  const [visitors, setVisitors] = useState<VisitorItem[]>([]);
  const [rotarians, setRotarians] = useState<RotarianItem[]>([]);
  const [delegates, setDelegates] = useState<DelegateItem[]>([]);

  // Dialog open states
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [annsDialogOpen, setAnnsDialogOpen] = useState(false);
  const [annetsDialogOpen, setAnnetsDialogOpen] = useState(false);
  const [visitorsDialogOpen, setVisitorsDialogOpen] = useState(false);
  const [rotariansDialogOpen, setRotariansDialogOpen] = useState(false);
  const [delegatesDialogOpen, setDelegatesDialogOpen] = useState(false);

  // Members data
  const [clubMembers, setClubMembers] = useState<ClubMemberSimple[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

  // Alerts
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [club, detail] = await Promise.all([
          getClub(clubId),
          getAttendance(clubId, attendanceId),
        ]);
        setClubName(club.clubName);

        // Pre-populate event details
        setEventName(detail.eventName || "");
        setDescription(detail.description || "");

        // Format eventDateTime as YYYY-MM-DDTHH:mm for datetime-local input
        setMeetingMode((detail.meetingMode as MeetingMode) ?? "in_person");
        setMeetingLink(detail.meetingLink ?? "");
        if (detail.eventLocal) {
          setEventDateTime(detail.eventLocal);
          setOriginalEventDateTime(detail.eventLocal);
        } else if (detail.eventDateTime) {
          const dt = new Date(detail.eventDateTime);
          const yyyy = dt.getFullYear();
          const mm = String(dt.getMonth() + 1).padStart(2, "0");
          const dd = String(dt.getDate()).padStart(2, "0");
          const hh = String(dt.getHours()).padStart(2, "0");
          const min = String(dt.getMinutes()).padStart(2, "0");
          const formatted = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
          setEventDateTime(formatted);
          setOriginalEventDateTime(formatted);
        }

        // Pre-populate sub-records
        setSelectedMemberIds(detail.members.map((m) => m.memberId));
        setAnns(detail.anns.map((a) => ({ tempId: String(a.id), annName: a.annName })));
        setAnnets(detail.annets.map((a) => ({ tempId: String(a.id), annetName: a.annetName })));
        setVisitors(detail.visitors.map((v) => ({ tempId: String(v.id), visitorName: v.visitorName, invitedBy: v.invitedBy || "" })));
        setRotarians(detail.rotarians.map((r) => ({ tempId: String(r.id), rotarianName: r.rotarianName, clubName: r.clubName || "" })));
        setDelegates(detail.delegates.map((d) => ({ tempId: String(d.id), rotarianName: d.rotarianName, districtDesignation: d.districtDesignation || "", clubName: d.clubName || "" })));
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load attendance.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, attendanceId]);

  // Fetch members when members dialog opens
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

  // Member selection helpers
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

  // Save handler
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
      await updateAttendance(clubId, attendanceId, {
        eventName: eventName.trim(),
        description: description.trim(),
        eventDateTime: eventDateTime + ":00",
        ...meetingPayload(meetingMode, meetingLink),
        memberIds: selectedMemberIds,
        anns: anns.map((a) => ({ annName: a.annName })),
        annets: annets.map((a) => ({ annetName: a.annetName })),
        visitors: visitors.map((v) => ({ visitorName: v.visitorName, invitedBy: v.invitedBy || null })),
        rotarians: rotarians.map((r) => ({ rotarianName: r.rotarianName, clubName: r.clubName || null })),
        delegates: delegates.map((d) => ({
          rotarianName: d.rotarianName,
          districtDesignation: d.districtDesignation || null,
          clubName: d.clubName || null,
        })),
      });
      setSuccessMessage("Attendance updated successfully.");
      setTimeout(() => router.push(`/clubs/${clubId}/attendance`), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to update attendance.");
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
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/attendance`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Edit Attendance</h2>
            <p className="text-muted-foreground text-base">{clubName}</p>
          </div>
        </div>

        {/* Section 1: Event Details */}
        <Section icon={FileText} title="Event Details" number={1}>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <Req hint="(max 500 chars)">Event Name</Req>
              <Input value={eventName} onChange={handleEventNameChange} placeholder="Event name" maxLength={500} />
              <p className="text-xs text-muted-foreground text-right">{eventName.length}/500</p>
            </div>
            <div className="space-y-1.5">
              <Req hint="(max 10000 chars)">Description</Req>
              <Textarea value={description} onChange={handleDescriptionChange} placeholder="Describe the event..." rows={4} maxLength={10000} />
              <p className="text-xs text-muted-foreground text-right">{description.length}/10000</p>
            </div>
            <div className="space-y-1.5">
              <Req>Event Date & Time</Req>
              <Input type="datetime-local" value={eventDateTime} onChange={(e) => setEventDateTime(e.target.value)} />
            </div>
            <MeetingModeFields mode={meetingMode} link={meetingLink} onModeChange={setMeetingMode} onLinkChange={setMeetingLink} />
          </div>
        </Section>

        {/* Section 2: Attendance */}
        <Section icon={Users} title="Attendance" number={2}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Members Card */}
            <div
              onClick={() => setMembersDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 cursor-pointer transition-colors"
            >
              <Users className="h-5 w-5 text-blue-600" />
              <span className="font-medium text-sm flex-1">Members</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                {selectedMemberIds.length}
              </span>
            </div>

            {/* Anns Card */}
            <div
              onClick={() => setAnnsDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-green-300 hover:bg-green-50/50 dark:hover:bg-green-950/20 cursor-pointer transition-colors"
            >
              <UserPlus className="h-5 w-5 text-green-600" />
              <span className="font-medium text-sm flex-1">Anns</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                {anns.length}
              </span>
            </div>

            {/* Annets Card */}
            <div
              onClick={() => setAnnetsDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-purple-300 hover:bg-purple-50/50 dark:hover:bg-purple-950/20 cursor-pointer transition-colors"
            >
              <UserPlus className="h-5 w-5 text-purple-600" />
              <span className="font-medium text-sm flex-1">Annets</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-[#CFE2F6] text-purple-700 text-xs font-bold">
                {annets.length}
              </span>
            </div>

            {/* Visitors Card */}
            <div
              onClick={() => setVisitorsDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-orange-300 hover:bg-orange-50/50 dark:hover:bg-orange-950/20 cursor-pointer transition-colors"
            >
              <UserCheck className="h-5 w-5 text-orange-600" />
              <span className="font-medium text-sm flex-1">Visitors</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-[#FFC65C] text-orange-700 text-xs font-bold">
                {visitors.length}
              </span>
            </div>

            {/* Rotarians (Other Club) Card */}
            <div
              onClick={() => setRotariansDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-teal-300 hover:bg-teal-50/50 dark:hover:bg-teal-950/20 cursor-pointer transition-colors"
            >
              <Globe className="h-5 w-5 text-teal-600" />
              <span className="font-medium text-sm flex-1">Rotarians (Other Club)</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-[#CFE2F6] text-teal-700 text-xs font-bold">
                {rotarians.length}
              </span>
            </div>

            {/* District Delegates Card */}
            <div
              onClick={() => setDelegatesDialogOpen(true)}
              className="flex items-center gap-3 p-4 border rounded-lg hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/20 cursor-pointer transition-colors"
            >
              <Award className="h-5 w-5 text-red-600" />
              <span className="font-medium text-sm flex-1">District Delegates</span>
              <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                {delegates.length}
              </span>
            </div>
          </div>
        </Section>

        {/* Save Button */}
        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
            {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Update Attendance</>}
          </Button>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* DIALOGS                                     */}
        {/* ═══════════════════════════════════════════ */}

        {/* Members Dialog */}
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

        {/* Anns Dialog */}
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

        {/* Annets Dialog */}
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

        {/* Visitors Dialog */}
        <VisitorsDialog
          open={visitorsDialogOpen}
          onOpenChange={setVisitorsDialogOpen}
          items={visitors}
          onAdd={(name, invitedBy) => setVisitors((prev) => [...prev, { tempId: genId(), visitorName: name, invitedBy }])}
          onUpdate={(tempId, name, invitedBy) => setVisitors((prev) => prev.map((v) => v.tempId === tempId ? { ...v, visitorName: name, invitedBy } : v))}
          onRemove={(tempId) => setVisitors((prev) => prev.filter((v) => v.tempId !== tempId))}
        />

        {/* Rotarians Dialog */}
        <RotariansDialog
          open={rotariansDialogOpen}
          onOpenChange={setRotariansDialogOpen}
          items={rotarians}
          onAdd={(name, club) => setRotarians((prev) => [...prev, { tempId: genId(), rotarianName: name, clubName: club }])}
          onUpdate={(tempId, name, club) => setRotarians((prev) => prev.map((r) => r.tempId === tempId ? { ...r, rotarianName: name, clubName: club } : r))}
          onRemove={(tempId) => setRotarians((prev) => prev.filter((r) => r.tempId !== tempId))}
        />

        {/* Delegates Dialog */}
        <DelegatesDialog
          open={delegatesDialogOpen}
          onOpenChange={setDelegatesDialogOpen}
          items={delegates}
          onAdd={(name, designation, club) => setDelegates((prev) => [...prev, { tempId: genId(), rotarianName: name, districtDesignation: designation, clubName: club }])}
          onUpdate={(tempId, name, designation, club) => setDelegates((prev) => prev.map((d) => d.tempId === tempId ? { ...d, rotarianName: name, districtDesignation: designation, clubName: club } : d))}
          onRemove={(tempId) => setDelegates((prev) => prev.filter((d) => d.tempId !== tempId))}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(`/clubs/${clubId}/attendance`)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
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
