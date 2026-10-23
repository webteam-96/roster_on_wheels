"use client";

import { useState } from "react";
import { ZoneListItem } from "@/types/zone";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash2, MapPin, Building2, Users, Globe } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RotaryLoader from "@/components/RotaryLoader";

interface ZoneCardProps {
  zone: ZoneListItem;
  onDelete: (zone: ZoneListItem) => void;
  isSuperAdmin?: boolean;
}

export default function ZoneCard({ zone, onDelete, isSuperAdmin }: ZoneCardProps) {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const handleCardClick = () => {
    if (navigating) return;
    if (!zone.isActive) return; // Inactive zones can't be drilled into — only edit (via menu) is allowed.
    setNavigating(true);
    router.push(`/zones/${zone.id}/districts`);
  };

  return (
    <Card
      className={`overflow-hidden border-primary/20 group relative transition-all duration-200 ${
        zone.isActive
          ? "cursor-pointer hover:shadow-xl hover:-translate-y-1"
          : "opacity-70 cursor-not-allowed"
      } ${navigating ? "opacity-60 pointer-events-none" : ""}`}
      onClick={handleCardClick}
      title={!zone.isActive ? "Zone is inactive. Click Edit (⋮) to activate." : undefined}
    >
      {navigating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 rounded-lg">
          <RotaryLoader size="sm" />
        </div>
      )}
      <CardContent className="p-0">
        <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
            <div className="flex h-full w-full items-center justify-center text-white">
              <Globe className="h-8 w-8" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg text-white">{zone.zoneName}</h3>
                <Badge className={`text-xs mt-1 ${zone.isActive ? "bg-green-500/80 text-white border-green-400/50" : "bg-red-500/80 text-white border-red-400/50"}`}>
                  {zone.isActive ? "Active" : "Inactive"}
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
                      {/* Inactive zones expose ONLY Edit — kill-switch rule. */}
                      {zone.isActive ? (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href={`/zones/${zone.id}/districts`}>
                              <MapPin className="mr-2 h-4 w-4" />
                              Districts
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/zones/${zone.id}/clubs`}>
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
                          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(zone)}>
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
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{zone.totalDistricts} District{zone.totalDistricts !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{zone.totalClubs} Club{zone.totalClubs !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{zone.totalMembers} Member{zone.totalMembers !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
