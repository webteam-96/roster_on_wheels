"use client";

import { useState } from "react";
import { DistrictListItem } from "@/types/district";
import { getPhotoUrl } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash2, Building2, Users, MapPin } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

interface DistrictCardProps {
  district: DistrictListItem;
  onDelete: (district: DistrictListItem) => void;
  isSuperAdmin?: boolean;
  zoneId?: number;
}

export default function DistrictCard({ district, onDelete, isSuperAdmin, zoneId }: DistrictCardProps) {
  const logoUrl = getPhotoUrl(district.districtLogoPath);
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const handleCardClick = () => {
    if (navigating) return;
    if (!district.isActive) return; // Inactive districts can't be drilled into — only edit (via menu) is allowed.
    setNavigating(true);
    router.push(`/districts/${district.id}/dashboard`);
  };

  return (
    <Card
      className={`overflow-hidden border-primary/20 group relative transition-all duration-200 ${
        district.isActive
          ? "cursor-pointer hover:shadow-xl hover:-translate-y-1"
          : "opacity-70 cursor-not-allowed"
      } ${navigating ? "opacity-60 pointer-events-none" : ""}`}
      onClick={handleCardClick}
      title={!district.isActive ? "District is inactive. Click Edit (⋮) to activate." : undefined}
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
              <Image src={logoUrl} alt={district.districtNumber} fill className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white">
                <MapPin className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg text-white">District {district.districtNumber}</h3>
                <Badge className={`text-xs mt-1 ${district.isActive ? "bg-green-500/80 text-white border-green-400/50" : "bg-red-500/80 text-white border-red-400/50"}`}>
                  {district.isActive ? "Active" : "Inactive"}
                </Badge>
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
                      {/* Inactive districts expose ONLY Edit — kill-switch rule. */}
                      {district.isActive ? (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href={`/districts/${district.id}/clubs`}>
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
                          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(district)}>
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
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{district.totalClubs} Club{district.totalClubs !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{district.totalMembers} Member{district.totalMembers !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
