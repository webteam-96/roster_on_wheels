"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { AttendanceDetail } from "@/types/attendance";
import { getClub, getAttendance } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import ErrorAlert from "@/components/ErrorAlert";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import {
  ArrowLeft, Pencil, CalendarDays, Users, UserCheck, UserPlus,
  Globe, Award, ChevronDown, ChevronUp,
} from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(appLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CollapsibleCard({
  icon: Icon,
  title,
  count,
  emptyMessage,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none py-3 px-4"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <span className="inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {count}
            </span>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 px-4 pb-4">
          {count === 0 ? (
            <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>
          ) : (
            children
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function AttendanceViewPage() {
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const attendanceId = Number(params.attendanceId);
  const { isSuperAdmin, isAdmin } = useAuth();

  const [clubName, setClubName] = useState("");
  const [attendance, setAttendance] = useState<AttendanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = isSuperAdmin || isAdmin;

  useEffect(() => {
    async function init() {
      try {
        const [club, att] = await Promise.all([
          getClub(clubId),
          getAttendance(clubId, attendanceId),
        ]);
        setClubName(club.clubName);
        setAttendance(att);
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load attendance details.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId, attendanceId]);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ProtectedRoute>
    );
  }

  if (!attendance) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <p className="text-muted-foreground">Attendance record not found.</p>
          <Button variant="outline" asChild>
            <Link href={`/clubs/${clubId}/attendance`}>
              <ArrowLeft className="mr-2 h-4 w-4" />Back to Attendance
            </Link>
          </Button>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-5 max-w-4xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/attendance`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                Attendance Details
              </h2>
              {clubName && (
                <p className="text-muted-foreground text-base">{clubName}</p>
              )}
            </div>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/clubs/${clubId}/attendance/${attendanceId}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />Edit
            </Button>
          )}
        </div>

        {/* Event Info Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">Event Information</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Event Name
              </p>
              <p className="text-sm font-semibold mt-0.5">{attendance.eventName}</p>
            </div>
            {attendance.description && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </p>
                <p className="text-sm font-medium mt-0.5">{attendance.description}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Event Date & Time
              </p>
              <p className="text-sm font-medium mt-0.5">
                {formatDateTime(attendance.eventDateTime)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Attendance Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Members */}
          <CollapsibleCard
            icon={Users}
            title="Members"
            count={attendance.members.length}
            emptyMessage="No members recorded"
          >
            <ul className="space-y-1">
              {attendance.members.map((m) => (
                <li key={m.id} className="text-sm font-medium">{m.memberName}</li>
              ))}
            </ul>
          </CollapsibleCard>

          {/* Anns */}
          <CollapsibleCard
            icon={UserCheck}
            title="Anns"
            count={attendance.anns.length}
            emptyMessage="No anns recorded"
          >
            <ul className="space-y-1">
              {attendance.anns.map((a) => (
                <li key={a.id} className="text-sm font-medium">{a.annName}</li>
              ))}
            </ul>
          </CollapsibleCard>

          {/* Annets */}
          <CollapsibleCard
            icon={UserCheck}
            title="Annets"
            count={attendance.annets.length}
            emptyMessage="No annets recorded"
          >
            <ul className="space-y-1">
              {attendance.annets.map((a) => (
                <li key={a.id} className="text-sm font-medium">{a.annetName}</li>
              ))}
            </ul>
          </CollapsibleCard>

          {/* Visitors */}
          <CollapsibleCard
            icon={UserPlus}
            title="Visitors"
            count={attendance.visitors.length}
            emptyMessage="No visitors recorded"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Visitor Name</TableHead>
                  <TableHead className="text-xs">Invited By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.visitors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm py-1.5">{v.visitorName}</TableCell>
                    <TableCell className="text-sm py-1.5">{v.invitedBy || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleCard>

          {/* Rotarians (Other Club) */}
          <CollapsibleCard
            icon={Globe}
            title="Rotarians (Other Club)"
            count={attendance.rotarians.length}
            emptyMessage="No rotarians recorded"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Rotarian Name</TableHead>
                  <TableHead className="text-xs">Club Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.rotarians.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm py-1.5">{r.rotarianName}</TableCell>
                    <TableCell className="text-sm py-1.5">{r.clubName || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleCard>

          {/* District Delegates */}
          <CollapsibleCard
            icon={Award}
            title="District Delegates"
            count={attendance.delegates.length}
            emptyMessage="No district delegates recorded"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Rotarian Name</TableHead>
                  <TableHead className="text-xs">District Designation</TableHead>
                  <TableHead className="text-xs">Club Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.delegates.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-sm py-1.5">{d.rotarianName}</TableCell>
                    <TableCell className="text-sm py-1.5">{d.districtDesignation || "-"}</TableCell>
                    <TableCell className="text-sm py-1.5">{d.clubName || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleCard>
        </div>

        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
