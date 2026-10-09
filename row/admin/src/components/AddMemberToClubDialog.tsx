"use client";

import { useState, useEffect } from "react";
import DateField from "@/components/DateField";
import { MemberListItem, PagedResult } from "@/types/member";
import { getMembers, getPhotoUrl } from "@/services/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, User, Check } from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Image from "next/image";

interface AddMemberToClubDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (memberId: number, joinedDate: string | null) => void;
  loading?: boolean;
}

export default function AddMemberToClubDialog({ open, onClose, onAdd, loading }: AddMemberToClubDialogProps) {
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberListItem | null>(null);
  const [joinedDate, setJoinedDate] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      setMembers([]);
      setSelectedMember(null);
      setJoinedDate("");
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.length < 2) { setMembers([]); return; }
      setSearching(true);
      try {
        const result: PagedResult<MemberListItem> = await getMembers(1, 10, search);
        setMembers(result.items);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleAdd = () => {
    if (!selectedMember) return;
    onAdd(selectedMember.id, joinedDate || null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Member to Club</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!selectedMember ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search by name, email, or Rotary ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              {searching && (
                <div className="flex justify-center py-4">
                  <RotaryLoader size="md" />
                </div>
              )}
              {!searching && members.length > 0 && (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {members.map((m) => {
                    const photoUrl = getPhotoUrl(m.profilePhotoPath);
                    return (
                      <button key={m.id} className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-primary/5 text-left transition-colors" onClick={() => setSelectedMember(m)}>
                        <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted flex-shrink-0">
                          {photoUrl ? (
                            <Image src={photoUrl} alt={m.memberName} fill className="object-cover" unoptimized />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                              <User className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.memberName}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.rotaryId} | {m.emailId}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {!searching && search.length >= 2 && members.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No members found.</p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
                <div className="relative h-10 w-10 overflow-hidden rounded-full bg-muted flex-shrink-0">
                  {getPhotoUrl(selectedMember.profilePhotoPath) ? (
                    <Image src={getPhotoUrl(selectedMember.profilePhotoPath)} alt={selectedMember.memberName} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                      <User className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{selectedMember.memberName}</p>
                  <p className="text-sm text-muted-foreground">{selectedMember.rotaryId}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedMember(null)}>Change</Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="joinedDate">Joined Date</Label>
                <DateField id="joinedDate" value={joinedDate} onChange={setJoinedDate} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!selectedMember || loading}>
            {loading ? <RotaryLoader size="sm" /> : <Check className="mr-2 h-4 w-4" />}
            Add Member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
