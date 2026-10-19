"use client";

import { useState } from "react";
import { ClubListItem } from "@/types/club";
import { getPhotoUrl } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash2, Building2, Users, MapPin, Calendar } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";
import { formatMeetingTime12Hour } from "@/lib/dateUtils";

interface ClubCardProps {
  club: ClubListItem;
  onDelete: (club: ClubListItem) => void;
  isSuperAdmin?: boolean;
  districtId?: number;
  viewOnly?: boolean;
}

export default function ClubCard({ club, onDelete, isSuperAdmin, districtId, viewOnly }: ClubCardProps) {
  const logoUrl = getPhotoUrl(club.clubLogoPath);
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const handleCardClick = () => {
    if (navigating) return;
    if (!club.isActive) return; // Inactive clubs can't be drilled into.
    setNavigating(true);
    if (viewOnly && districtId) {
      router.push(`/districts/${districtId}/clubs/${club.id}`);
    } else {
      router.push(`/clubs/${club.id}/dashboard${districtId ? `?districtId=${districtId}` : ""}`);
    }
  };

  return (
    <Card
      className={`overflow-hidden border-primary/20 group relative transition-all duration-200 ${
        club.isActive
          ? "cursor-pointer hover:shadow-xl hover:-translate-y-1"
          : "opacity-70 cursor-not-allowed"
      } ${navigating ? "opacity-60 pointer-events-none" : ""}`}
      onClick={handleCardClick}
      title={!club.isActive ? "Club is inactive. Click Edit (⋮) to activate." : undefined}
    >
      {navigating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 rounded-lg">
          <RotaryLoader size="sm" />
        </div>
      )}
      <CardContent className="p-0">
        <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
            {logoUrl ? (
              <Image src={logoUrl} alt={club.clubName} fill className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white">
                <Building2 className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-base truncate text-white">{club.clubName}</h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge className="text-xs bg-white/20 text-white border-white/30">{club.clubRotaryId}</Badge>
                  <Badge className="text-xs bg-white/20 text-white border-white/30">{club.districtNumber}</Badge>
                </div>
              </div>
              {isSuperAdmin && (
                <div onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Inactive clubs expose ONLY Edit — kill-switch rule. */}
                      <DropdownMenuItem asChild>
                        <Link href={`/clubs/edit/${club.id}${districtId ? `?districtId=${districtId}` : ""}`}><Pencil className="mr-2 h-4 w-4" />Edit</Link>
                      </DropdownMenuItem>
                      {club.isActive && (
                        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(club)}>
                          <Trash2 className="mr-2 h-4 w-4" />Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
          {club.meetingDay && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{club.meetingDay}{club.meetingFromTime ? ` | ${formatMeetingTime12Hour(club.meetingFromTime)}` : ""}{club.meetingToTime ? ` - ${formatMeetingTime12Hour(club.meetingToTime)}` : ""}</span>
            </div>
          )}
          {(club.city || club.state) && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{[club.city, club.state].filter(Boolean).join(", ")}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{club.totalMembers} Member{club.totalMembers !== 1 ? "s" : ""}</span>
          </div>
          <Badge variant={club.isActive ? "default" : "destructive"} className="text-xs">
            {club.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
