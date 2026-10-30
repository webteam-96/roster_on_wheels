"use client";

import { MemberListItem } from "@/types/member";
import { useFeature } from "@/contexts/BrandContext";
import { getPhotoUrl } from "@/services/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, User, Shield, ShieldOff } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";

interface MemberTableProps {
  members: MemberListItem[];
  onDelete: (member: MemberListItem) => void;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  memberRoles?: Record<number, string[]>;
  onAssignAdmin?: (id: number) => void;
  onRemoveAdmin?: (id: number) => void;
}

export default function MemberTable({
  members,
  onDelete,
  isSuperAdmin,
  isAdmin: isLoggedInAdmin,
  memberRoles,
  onAssignAdmin,
  onRemoveAdmin,
}: MemberTableProps) {
  const showBloodGroup = useFeature("member.bloodGroup");
  const getRoleBadges = (memberId: number) => {
    const roles = memberRoles?.[memberId] || [];
    return (
      <div className="flex flex-wrap gap-1">
        {roles.filter((r, i, arr) => arr.indexOf(r) === i).map((role) => (
          <Badge key={role} className={`text-xs ${
            role === "SuperAdmin" ? "bg-primary text-primary-foreground" :
            role === "Admin" ? "bg-blue-600 text-white" :
            ""
          }`} variant={role !== "SuperAdmin" && role !== "Admin" ? "outline" : "default"}>
            {role}
          </Badge>
        ))}
        {!roles.includes("Member") && (
          <Badge variant="outline" className="text-xs">Member</Badge>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="w-12"></TableHead>
            <TableHead className="text-base font-semibold">Name</TableHead>
            <TableHead className="hidden md:table-cell text-base font-semibold">Rotary ID</TableHead>
            <TableHead className="hidden md:table-cell text-base font-semibold">Role</TableHead>
            <TableHead className="hidden lg:table-cell text-base font-semibold">Business</TableHead>
            <TableHead className="hidden md:table-cell text-base font-semibold">City</TableHead>
            <TableHead className="hidden sm:table-cell text-base font-semibold">Phone</TableHead>
            <TableHead className="hidden lg:table-cell text-base font-semibold">Email</TableHead>
            {showBloodGroup && <TableHead className="hidden sm:table-cell text-base font-semibold">Blood Group</TableHead>}
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const photoUrl = getPhotoUrl(member.profilePhotoPath);
            const roles = memberRoles?.[member.id] || [];
            const isAdmin = roles.includes("Admin");

            return (
              <TableRow key={member.id} className="cursor-pointer hover:bg-primary/5 transition-colors" onClick={() => window.location.href = `/members/edit/${member.id}`}>
                <TableCell>
                  <div className="relative h-8 w-8 overflow-hidden rounded-full bg-muted">
                    {photoUrl ? (
                      <Image
                        src={photoUrl}
                        alt={member.memberName}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/members/edit/${member.id}`}
                    className="hover:underline text-primary font-semibold hover:text-primary/80"
                  >
                    {member.memberName}
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {member.rotaryId || "-"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {getRoleBadges(member.id)}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div>
                    {member.designation && (
                      <span className="text-sm">{member.designation}</span>
                    )}
                    {member.businessName && (
                      <span className="block text-xs text-muted-foreground">
                        {member.businessName}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {member.resCity || "-"}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {member.primaryMobileNumber ? (member.primaryCountryPhoneCode ? `${member.primaryCountryPhoneCode}-${member.primaryMobileNumber}` : member.primaryMobileNumber) : "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {member.emailId || "-"}
                </TableCell>
                {showBloodGroup && (
                  <TableCell className="hidden sm:table-cell">
                    {member.bloodGroup ? (
                      <Badge variant="outline">{member.bloodGroup}</Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
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
                          onClick={(e) => { e.stopPropagation(); onDelete(member); }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                      {(isSuperAdmin || isLoggedInAdmin) && (   /* SuperAdmin members can be made Admin too (2026-10-09) */
                        <>
                          <DropdownMenuSeparator />
                          {isAdmin ? (
                            <DropdownMenuItem
                              onClick={(e) => { e.stopPropagation(); onRemoveAdmin?.(member.id); }}
                            >
                              <ShieldOff className="mr-2 h-4 w-4" />
                              Remove Admin
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={(e) => { e.stopPropagation(); onAssignAdmin?.(member.id); }}
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Make Admin
                            </DropdownMenuItem>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
