"use client";

import { useState } from "react";
import { ZoneListItem } from "@/types/zone";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, Globe, MapPin, Building2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

interface ZoneTableProps {
  zones: ZoneListItem[];
  onDelete: (zone: ZoneListItem) => void;
  isSuperAdmin?: boolean;
}

export default function ZoneTable({ zones, onDelete, isSuperAdmin }: ZoneTableProps) {
  const router = useRouter();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  const handleRowClick = (zone: ZoneListItem) => {
    if (navigatingId) return;
    if (!zone.isActive) return; // Inactive zones can't be drilled into — only edit (via menu) is allowed.
    setNavigatingId(zone.id);
    router.push(`/zones/${zone.id}/districts`);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="w-12"></TableHead>
            <TableHead className="text-base font-semibold">Zone Name</TableHead>
            <TableHead className="text-base font-semibold">Districts</TableHead>
            <TableHead className="text-base font-semibold">Clubs</TableHead>
            <TableHead className="text-base font-semibold">Members</TableHead>
            <TableHead className="text-base font-semibold">Status</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {zones.map((zone) => (
            <TableRow
              key={zone.id}
              className={`transition-colors relative ${
                zone.isActive
                  ? "cursor-pointer hover:bg-primary/5"
                  : "opacity-70 cursor-not-allowed"
              } ${navigatingId === zone.id ? "opacity-60 pointer-events-none" : ""}`}
              onClick={() => handleRowClick(zone)}
              title={!zone.isActive ? "Zone is inactive. Click Edit (⋮) to activate." : undefined}
            >
              <TableCell>
                {navigatingId === zone.id ? (
                  <RotaryLoader size="sm" />
                ) : (
                  <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                    <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                      <Globe className="h-4 w-4" />
                    </div>
                  </div>
                )}
              </TableCell>
              <TableCell className="font-medium">
                <span className="text-primary font-semibold">{zone.zoneName}</span>
              </TableCell>
              <TableCell>{zone.totalDistricts}</TableCell>
              <TableCell>{zone.totalClubs}</TableCell>
              <TableCell>{zone.totalMembers}</TableCell>
              <TableCell>
                <Badge variant={zone.isActive ? "default" : "destructive"}>
                  {zone.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                {isSuperAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Inactive zones expose ONLY Edit — kill-switch rule. */}
                      {zone.isActive ? (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href={`/zones/${zone.id}/districts`} onClick={(e) => e.stopPropagation()}>
                              <MapPin className="mr-2 h-4 w-4" />
                              Districts
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/zones/${zone.id}/clubs`} onClick={(e) => e.stopPropagation()}>
                              <Building2 className="mr-2 h-4 w-4" />
                              Clubs
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/zones/edit/${zone.id}`}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(zone); }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem asChild>
                          <Link href={`/zones/edit/${zone.id}`}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
