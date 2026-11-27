"use client";

import { Card } from "@/components/ui/card";
import { useState } from "react";
import { ClubListItem } from "@/types/club";
import { getPhotoUrl } from "@/services/api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, Building2 } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

interface ClubTableProps {
  clubs: ClubListItem[];
  onDelete: (club: ClubListItem) => void;
  isSuperAdmin?: boolean;
  districtId?: number;
  viewOnly?: boolean;
  // upstream 2026-10-21: parent zone / district inactive, so this row is hidden too (SuperAdmin sees it marked).
  parentInactive?: boolean;
}

export default function ClubTable({ clubs, onDelete, isSuperAdmin, districtId, viewOnly, parentInactive }: ClubTableProps) {
  const router = useRouter();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  const handleRowClick = (club: ClubListItem) => {
    if (navigatingId) return;
    if (!club.isActive || parentInactive) {
      // upstream 2026-10-21: inactive = hidden everywhere; SuperAdmin may still look inside (read-only).
      if (isSuperAdmin) router.push(`/clubs/${club.id}/members`);
      return;
    }
    setNavigatingId(club.id);
    if (viewOnly && districtId) {
      router.push(`/districts/${districtId}/clubs/${club.id}`);
    } else {
      router.push(`/clubs/${club.id}/dashboard${districtId ? `?districtId=${districtId}` : ""}`);
    }
  };

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Club Name</TableHead>
            <TableHead className="hidden md:table-cell">Rotary ID</TableHead>
            <TableHead className="hidden md:table-cell">District</TableHead>
            <TableHead className="hidden lg:table-cell">Meeting Day</TableHead>
            <TableHead className="hidden md:table-cell">City</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clubs.map((club) => {
            const logoUrl = getPhotoUrl(club.clubLogoPath);
            return (
              <TableRow
                key={club.id}
                className={`transition-colors ${
                  club.isActive && !parentInactive
                    ? "cursor-pointer hover:bg-primary/5"
                    : isSuperAdmin ? "opacity-70 cursor-pointer" : "opacity-70 cursor-not-allowed"
                } ${navigatingId === club.id ? "opacity-60 pointer-events-none" : ""}`}
                onClick={() => handleRowClick(club)}
                title={parentInactive && club.isActive ? "Its parent is inactive, so it is hidden everywhere. SuperAdmin view only." : !club.isActive ? "Club is inactive. Click Edit (⋮) to activate." : undefined}
              >
                <TableCell>
                  {navigatingId === club.id ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                      {logoUrl ? (
                        <Image src={logoUrl} alt={club.clubName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                          <Building2 className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <span className="text-primary font-semibold">{club.clubName}</span>
                </TableCell>
                <TableCell className="hidden md:table-cell">{club.clubRotaryId}</TableCell>
                <TableCell className="hidden md:table-cell">{club.districtNumber}</TableCell>
                <TableCell className="hidden lg:table-cell">{club.meetingDay || "-"}</TableCell>
                <TableCell className="hidden md:table-cell">{club.city || "-"}</TableCell>
                <TableCell>{club.totalMembers}</TableCell>
                <TableCell>
                  <Badge variant={club.isActive && !parentInactive ? "default" : "destructive"}>{club.isActive && !parentInactive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  {isSuperAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="row-btn-sm" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Inactive clubs expose ONLY Edit — kill-switch rule. */}
                        <DropdownMenuItem asChild>
                          <Link href={`/clubs/edit/${club.id}${districtId ? `?districtId=${districtId}` : ""}`}><Pencil className="mr-2 h-4 w-4" />Edit</Link>
                        </DropdownMenuItem>
                        {club.isActive && (
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(club); }}>
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
