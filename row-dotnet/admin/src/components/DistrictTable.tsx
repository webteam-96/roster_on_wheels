"use client";

import { useState } from "react";
import { DistrictListItem } from "@/types/district";
import { getPhotoUrl } from "@/services/api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, MapPin, Building2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

interface DistrictTableProps {
  districts: DistrictListItem[];
  onDelete: (district: DistrictListItem) => void;
  isSuperAdmin?: boolean;
  zoneId?: number;
}

export default function DistrictTable({ districts, onDelete, isSuperAdmin, zoneId }: DistrictTableProps) {
  const router = useRouter();
  const [navigatingId, setNavigatingId] = useState<number | null>(null);

  const handleRowClick = (district: DistrictListItem) => {
    if (navigatingId) return;
    if (!district.isActive) return; // Inactive districts can't be drilled into.
    setNavigatingId(district.id);
    router.push(`/districts/${district.id}/dashboard`);
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="w-12 text-primary-foreground"></TableHead>
            <TableHead className="text-primary-foreground text-base font-semibold">District Number</TableHead>
            <TableHead className="text-primary-foreground text-base font-semibold">Clubs</TableHead>
            <TableHead className="text-primary-foreground text-base font-semibold">Members</TableHead>
            <TableHead className="text-primary-foreground text-base font-semibold">Status</TableHead>
            <TableHead className="w-12 text-primary-foreground"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {districts.map((district) => {
            const logoUrl = getPhotoUrl(district.districtLogoPath);
            return (
              <TableRow
                key={district.id}
                className={`transition-colors ${
                  district.isActive
                    ? "cursor-pointer hover:bg-primary/5"
                    : "opacity-70 cursor-not-allowed"
                } ${navigatingId === district.id ? "opacity-60 pointer-events-none" : ""}`}
                onClick={() => handleRowClick(district)}
                title={!district.isActive ? "District is inactive. Click Edit (⋮) to activate." : undefined}
              >
                <TableCell>
                  {navigatingId === district.id ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                      {logoUrl ? (
                        <Image src={logoUrl} alt={district.districtNumber} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                          <MapPin className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">
                  <span className="text-primary font-semibold">{district.districtNumber}</span>
                </TableCell>
                <TableCell>{district.totalClubs}</TableCell>
                <TableCell>{district.totalMembers}</TableCell>
                <TableCell>
                  <Badge variant={district.isActive ? "default" : "destructive"}>
                    {district.isActive ? "Active" : "Inactive"}
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
                        {district.isActive ? (
                          <>
                            <DropdownMenuItem asChild>
                              <Link href={`/districts/${district.id}/clubs`} onClick={(e) => e.stopPropagation()}>
                                <Building2 className="mr-2 h-4 w-4" />
                                Clubs
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/districts/edit/${district.id}${zoneId ? `?zoneId=${zoneId}` : ""}`}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(district); }}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem asChild>
                            <Link href={`/districts/edit/${district.id}${zoneId ? `?zoneId=${zoneId}` : ""}`}>
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
