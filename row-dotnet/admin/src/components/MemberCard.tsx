"use client";

import { MemberListItem } from "@/types/member";
import { getPhotoUrl } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  User,
  Pencil,
  Trash2,
  Shield,
  ShieldOff,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface MemberCardProps {
  member: MemberListItem;
  onDelete: (member: MemberListItem) => void;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  memberRoles?: Record<number, string[]>;
  onAssignAdmin?: (id: number) => void;
  onRemoveAdmin?: (id: number) => void;
}

export default function MemberCard({ member, onDelete, isSuperAdmin, isAdmin: isLoggedInAdmin, memberRoles, onAssignAdmin, onRemoveAdmin }: MemberCardProps) {
  const photoUrl = getPhotoUrl(member.profilePhotoPath);
  const roles = memberRoles?.[member.id] || [];
  const isAdmin = roles.includes("Admin");
  const isMemberSuperAdmin = roles.includes("SuperAdmin");

  return (
    <Card className="overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-primary/20 cursor-pointer group">
      <CardContent className="p-0">
        <div className="flex items-center gap-4 p-4 bg-primary text-primary-foreground rounded-t-lg group-hover:bg-primary/90 transition-colors">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-white/20 border-2 border-white/40">
            {photoUrl ? (
              <Image
                src={photoUrl}
                alt={member.memberName}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white">
                <User className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-base truncate text-white">
                  {member.memberName}
                </h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  {member.rotaryId && (
                    <Badge className="text-xs bg-white/20 text-white border-white/30 hover:bg-white/30">
                      ID: {member.rotaryId}
                    </Badge>
                  )}
                  {roles.filter((r, i, arr) => arr.indexOf(r) === i).map((role) => (
                    <Badge key={role} className={`text-xs ${
                      role === "SuperAdmin" ? "bg-yellow-500/80 text-white border-yellow-400/50" :
                      role === "Admin" ? "bg-blue-500/80 text-white border-blue-400/50" :
                      "bg-white/20 text-white border-white/30"
                    }`}>{role}</Badge>
                  ))}
                  {!roles.includes("Member") && (
                    <Badge className="text-xs bg-white/20 text-white border-white/30">Member</Badge>
                  )}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/members/edit/${member.id}`}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                  {isSuperAdmin && (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => onDelete(member)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  )}
                  {(isSuperAdmin || isLoggedInAdmin) && !isMemberSuperAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      {isAdmin ? (
                        <DropdownMenuItem onClick={() => onRemoveAdmin?.(member.id)}>
                          <ShieldOff className="mr-2 h-4 w-4" />
                          Remove Admin
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => onAssignAdmin?.(member.id)}>
                          <Shield className="mr-2 h-4 w-4" />
                          Make Admin
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <Link href={`/members/edit/${member.id}`} className="block">
          <div className="border-t px-4 py-3 space-y-2 text-sm text-muted-foreground group-hover:bg-primary/5 transition-colors">
            {member.designation && member.businessName && (
              <div className="flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">
                  {member.designation}, {member.businessName}
                </span>
              </div>
            )}
            {(member.resCity || member.resState) && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">
                  {[member.resCity, member.resState].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
            {member.primaryMobileNumber && (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{member.primaryCountryPhoneCode ? `${member.primaryCountryPhoneCode}-${member.primaryMobileNumber}` : member.primaryMobileNumber}</span>
              </div>
            )}
            {member.emailId && (
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{member.emailId}</span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              {member.bloodGroup && (
                <Badge variant="outline" className="text-xs">
                  {member.bloodGroup}
                </Badge>
              )}
              {member.gender && (
                <Badge variant="outline" className="text-xs">
                  {member.gender}
                </Badge>
              )}
            </div>
          </div>
        </Link>
      </CardContent>
    </Card>
  );
}
